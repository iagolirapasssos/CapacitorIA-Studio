// server/services/buildService.js - Versão corrigida

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

class BuildService {
  constructor() {
    this.isMacOS = os.platform() === 'darwin';
    this.isLinux = os.platform() === 'linux';
    this.isWindows = os.platform() === 'win32';
    this.progressCallback = null;
  }

  async runBuild(projectPath, platform, onProgress) {
    this.progressCallback = onProgress;
    const fullPath = path.resolve(projectPath);
    
    console.log(`📦 Build requested for: ${fullPath}`);
    console.log(`📱 Platform: ${platform}`);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Project not found at: ${fullPath}`);
    }

    const packageJsonPath = path.join(fullPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found.');
    }

    await this._fixCapacitorConfig(fullPath);

    if (platform === 'ios' && !this.isMacOS) {
      throw new Error('iOS build is only possible on macOS');
    }

    return await this._runBuildSteps(fullPath, platform);
  }

  async _fixCapacitorConfig(projectPath) {
    const configPath = path.join(projectPath, 'capacitor.config.json');
    
    if (fs.existsSync(configPath)) {
      try {
        const config = await fs.readJson(configPath);
        if (!config.webDir || config.webDir === '.' || config.webDir === './') {
          config.webDir = 'www';
          await fs.writeJson(configPath, config, { spaces: 2 });
          console.log('✅ capacitor.config.json fixed: webDir = "www"');
        }
        return config;
      } catch (error) {
        console.warn('Error reading capacitor.config.json:', error);
      }
    }
    
    const config = {
      appId: 'com.example.myapp',
      appName: 'My App',
      webDir: 'www',
      bundledWebRuntime: false,
      server: {
        androidScheme: 'https'
      },
      android: {
        compileSdkVersion: 35,
        targetSdkVersion: 35,
        minSdkVersion: 23
      }
    };
    await fs.writeJson(configPath, config, { spaces: 2 });
    console.log('✅ capacitor.config.json created with webDir = "www"');
    return config;
  }

  async _runBuildSteps(projectPath, platform) {
    let totalSteps;
    if (platform === 'android' || platform === 'android-bundle') {
      totalSteps = 10;
    } else if (platform === 'ios') {
      totalSteps = 8;
    } else {
      totalSteps = 5;
    }
    let currentStep = 0;
    let apkFiles = [];
    let aabFiles = [];
    let ipaFiles = [];

    // Step 1: Install dependencies
    this._emitProgress({
      step: ++currentStep,
      total: totalSteps,
      message: 'Installing dependencies...',
      command: 'npm install'
    });
    await this._executeCommand('npm', ['install', '--legacy-peer-deps'], projectPath);

    // Step 2: Install Capacitor if not present
    this._emitProgress({
      step: ++currentStep,
      total: totalSteps,
      message: 'Checking Capacitor...',
      command: 'npm list @capacitor/cli'
    });
    
    const packageJson = await fs.readJson(path.join(projectPath, 'package.json'));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (!deps['@capacitor/cli']) {
      await this._executeCommand('npm', ['install', '@capacitor/cli', '@capacitor/core', '@capacitor/android', '@capacitor/ios', '--save-dev'], projectPath);
    }

    // Step 3: Fix Kotlin version conflict in android/build.gradle
    if (platform === 'android' || platform === 'android-bundle') {
      const gradlePath = path.join(projectPath, 'android/build.gradle');
      if (fs.existsSync(gradlePath)) {
        let gradleContent = await fs.readFile(gradlePath, 'utf-8');
        // Force Kotlin version to avoid conflicts
        if (!gradleContent.includes('kotlinVersion')) {
          gradleContent = gradleContent.replace(
            /ext\s*{/,
            `ext {\n        kotlinVersion = '1.9.22'`
          );
          await fs.writeFile(gradlePath, gradleContent);
          console.log('✅ Fixed Kotlin version in build.gradle');
        }
      }
      
      // Fix app/build.gradle to exclude duplicate kotlin stdlib
      const appGradlePath = path.join(projectPath, 'android/app/build.gradle');
      if (fs.existsSync(appGradlePath)) {
        let appGradleContent = await fs.readFile(appGradlePath, 'utf-8');
        // Add configurations to exclude duplicate kotlin stdlib
        if (!appGradleContent.includes('configurations.all')) {
          const configBlock = `
configurations.all {
    resolutionStrategy {
        force "org.jetbrains.kotlin:kotlin-stdlib:$kotlinVersion"
        force "org.jetbrains.kotlin:kotlin-stdlib-jdk7:$kotlinVersion"
        force "org.jetbrains.kotlin:kotlin-stdlib-jdk8:$kotlinVersion"
    }
}`;
          appGradleContent = appGradleContent.replace(
            /android\s*{/,
            `${configBlock}\n\nandroid {`
          );
          await fs.writeFile(appGradlePath, appGradleContent);
          console.log('✅ Fixed Kotlin duplicate classes in app/build.gradle');
        }
      }
    }

    // Step 4: Android specific
    if (platform === 'android' || platform === 'android-bundle') {
      const androidDir = path.join(projectPath, 'android');
      if (!fs.existsSync(androidDir)) {
        this._emitProgress({
          step: ++currentStep,
          total: totalSteps,
          message: 'Adding Android platform...',
          command: 'npx cap add android'
        });
        await this._executeCommand('npx', ['cap', 'add', 'android'], projectPath);
      }

      this._emitProgress({
        step: ++currentStep,
        total: totalSteps,
        message: 'Syncing Capacitor...',
        command: 'npx cap sync android'
      });
      await this._executeCommand('npx', ['cap', 'sync', 'android'], projectPath);

      // Step 5: Build APK
      this._emitProgress({
        step: ++currentStep,
        total: totalSteps,
        message: 'Generating APK (debug)...',
        command: './gradlew assembleDebug'
      });
      
      await this._executeCommand('./gradlew', ['assembleDebug'], androidDir);

      // Step 6: Build AAB (if requested)
      if (platform === 'android-bundle') {
        this._emitProgress({
          step: ++currentStep,
          total: totalSteps,
          message: 'Generating AAB (release)...',
          command: './gradlew bundleRelease'
        });
        await this._executeCommand('./gradlew', ['bundleRelease'], androidDir);
      }

      // Step 7: Find generated files
      this._emitProgress({
        step: ++currentStep,
        total: totalSteps,
        message: 'Locating generated files...',
        command: 'find outputs'
      });

      const outputsDir = path.join(androidDir, 'app/build/outputs');
      
      // Find APKs
      const apkDirs = ['apk/debug', 'apk/release'];
      for (const dir of apkDirs) {
        const fullDir = path.join(outputsDir, dir);
        if (fs.existsSync(fullDir)) {
          const files = await fs.readdir(fullDir);
          for (const file of files) {
            if (file.endsWith('.apk')) {
              apkFiles.push(path.join(fullDir, file));
            }
          }
        }
      }

      // Find AABs
      const aabDirs = ['bundle/release', 'bundle/debug'];
      for (const dir of aabDirs) {
        const fullDir = path.join(outputsDir, dir);
        if (fs.existsSync(fullDir)) {
          const files = await fs.readdir(fullDir);
          for (const file of files) {
            if (file.endsWith('.aab')) {
              aabFiles.push(path.join(fullDir, file));
            }
          }
        }
      }

      currentStep++;
    }

    // Step 8: iOS specific
    if (platform === 'ios' && this.isMacOS) {
      const iosDir = path.join(projectPath, 'ios');
      
      if (!fs.existsSync(iosDir)) {
        this._emitProgress({
          step: ++currentStep,
          total: totalSteps,
          message: 'Adding iOS platform...',
          command: 'npx cap add ios'
        });
        await this._executeCommand('npx', ['cap', 'add', 'ios'], projectPath);
      }

      this._emitProgress({
        step: ++currentStep,
        total: totalSteps,
        message: 'Syncing Capacitor...',
        command: 'npx cap sync ios'
      });
      await this._executeCommand('npx', ['cap', 'sync', 'ios'], projectPath);

      // Step 9: Build iOS
      this._emitProgress({
        step: ++currentStep,
        total: totalSteps,
        message: 'Building iOS...',
        command: 'xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug'
      });
      await this._executeCommand('xcodebuild', [
        '-workspace', 'App.xcworkspace',
        '-scheme', 'App',
        '-configuration', 'Debug'
      ], iosDir);

      // Step 10: Find IPA
      const buildDir = path.join(iosDir, 'build');
      if (fs.existsSync(buildDir)) {
        const findIpa = async (dir) => {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await findIpa(fullPath);
            } else if (entry.name.endsWith('.ipa')) {
              ipaFiles.push(fullPath);
            }
          }
        };
        await findIpa(buildDir);
      }

      currentStep++;
    }

    // Step 11: Final
    this._emitProgress({
      step: ++currentStep,
      total: totalSteps,
      message: `✅ Build ${platform} completed!`,
      command: 'Finished'
    });

    const result = {
      success: true,
      platform,
      apkFiles,
      aabFiles,
      ipaFiles,
      message: `Build ${platform} completed! ${apkFiles.length} APK(s), ${aabFiles.length} AAB(s), ${ipaFiles.length} IPA(s) generated.`
    };

    // Emit download info
    if (apkFiles.length > 0 || aabFiles.length > 0 || ipaFiles.length > 0) {
      this._emitProgress({
        type: 'download-ready',
        files: {
          apk: apkFiles.map(f => ({ path: f, name: path.basename(f) })),
          aab: aabFiles.map(f => ({ path: f, name: path.basename(f) })),
          ipa: ipaFiles.map(f => ({ path: f, name: path.basename(f) }))
        }
      });
    }

    return result;
  }

  _executeCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
      console.log(`▶️ Executing: ${command} ${args ? args.join(' ') : ''} in ${cwd}`);
      
      const child = spawn(command, args || [], {
        cwd: cwd,
        shell: true,
        env: { 
          ...process.env,
          JAVA_HOME: process.env.JAVA_HOME || '/usr/lib/jvm/java-17-openjdk-amd64'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        this._emitProgress({
          type: 'output',
          data: output
        });
        console.log(`📤 ${output.trim()}`);
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        this._emitProgress({
          type: 'error',
          data: output
        });
        console.error(`📥 ${output.trim()}`);
      });

      child.on('close', (code) => {
        console.log(`✅ Command finished with code: ${code}`);
        
        if (code !== 0 && code !== null) {
          reject(new Error(stderr || `Command failed with code ${code}`));
        } else {
          resolve({
            code,
            stdout,
            stderr
          });
        }
      });

      child.on('error', (error) => {
        console.error(`❌ Command error: ${error.message}`);
        reject(new Error(error.message));
      });
    });
  }

  _emitProgress(data) {
    if (this.progressCallback) {
      this.progressCallback(data);
    }
  }

  async createCapacitorProject(projectPath, appName = 'My App', appId = 'com.example.app') {
    const fullPath = path.resolve(projectPath);
    
    await fs.ensureDir(fullPath);
    
    const wwwDir = path.join(fullPath, 'www');
    await fs.ensureDir(wwwDir);
    
    const packageJson = {
      name: path.basename(fullPath),
      version: '1.0.0',
      description: 'App created with CapacitorIA Studio',
      main: 'index.js',
      scripts: {
        'build': 'echo "Build project"',
        'start': 'npx cap serve',
        'sync': 'npx cap sync',
        'open:android': 'npx cap open android',
        'open:ios': 'npx cap open ios'
      },
      dependencies: {
        '@capacitor/android': '^5.0.0',
        '@capacitor/ios': '^5.0.0',
        '@capacitor/core': '^5.0.0',
        '@capacitor/cli': '^5.0.0'
      }
    };
    await fs.writeJson(path.join(fullPath, 'package.json'), packageJson, { spaces: 2 });
    
    const config = {
      appId: appId,
      appName: appName,
      webDir: 'www',
      bundledWebRuntime: false,
      server: {
        androidScheme: 'https'
      },
      android: {
        compileSdkVersion: 35,
        targetSdkVersion: 35,
        minSdkVersion: 23,
        versionCode: 1,
        versionName: '1.0.0'
      }
    };
    await fs.writeJson(path.join(fullPath, 'capacitor.config.json'), config, { spaces: 2 });
    
    // Create www files
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <header><h1>🚀 ${appName}</h1></header>
    <main>
      <p>Welcome to your Capacitor app!</p>
      <button id="btnClick">Click me</button>
      <p id="message"></p>
    </main>
  </div>
  <script src="script.js"></script>
</body>
</html>`;
    await fs.writeFile(path.join(wwwDir, 'index.html'), indexHtml);
    
    const styleCss = `* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height:100vh; display:flex; align-items:center; justify-content:center; }
#app { background:rgba(255,255,255,0.95); border-radius:16px; padding:40px; max-width:500px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.3); text-align:center; }
header h1 { font-size:28px; margin-bottom:20px; color:#333; }
main p { color:#666; font-size:16px; line-height:1.6; margin-bottom:20px; }
button { background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:white; border:none; padding:12px 30px; border-radius:8px; font-size:16px; font-weight:600; cursor:pointer; transition:transform 0.2s, box-shadow 0.2s; }
button:hover { transform:scale(1.05); box-shadow:0 8px 25px rgba(102,126,234,0.4); }
button:active { transform:scale(0.95); }
#message { margin-top:16px; font-size:14px; color:#764ba2; min-height:24px; }`;
    await fs.writeFile(path.join(wwwDir, 'style.css'), styleCss);
    
    const scriptJs = `document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnClick');
  const message = document.getElementById('message');
  btn.addEventListener('click', () => {
    const now = new Date();
    message.textContent = \`Clicked at \${now.toLocaleTimeString()}\`;
  });
  console.log('🚀 App initialized!');
});`;
    await fs.writeFile(path.join(wwwDir, 'script.js'), scriptJs);
    
    console.log(`✅ Capacitor project created at: ${fullPath}`);
    return fullPath;
  }
}

module.exports = new BuildService();