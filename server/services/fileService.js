const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

class FileService {
  constructor() {
    this.watchers = new Map();
  }

  async getProjectFiles(projectPath) {
    const files = [];
    
    if (!fs.existsSync(projectPath)) {
      return files;
    }
    
    await this._walkDir(projectPath, '', files);
    return files;
  }

  async _walkDir(dir, basePath, files) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(basePath, entry.name);
        
        // Ignore hidden directories and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        
        if (entry.isDirectory()) {
          await this._walkDir(fullPath, relativePath, files);
        } else {
          const stats = await fs.stat(fullPath);
          const ext = path.extname(entry.name).toLowerCase();
          const isBinary = this._isBinaryFile(ext, entry.name);
          
          let content = null;
          if (!isBinary) {
            try {
              content = await fs.readFile(fullPath, 'utf-8');
            } catch (e) {
              content = null;
            }
          } else {
            // For binary files, read as base64
            try {
              content = await fs.readFile(fullPath, 'base64');
            } catch (e) {
              content = null;
            }
          }

          files.push({
            path: relativePath,
            name: entry.name,
            size: stats.size,
            modified: stats.mtime,
            isBinary,
            content,
            mimeType: mime.lookup(entry.name) || 'application/octet-stream'
          });
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
    }
  }

  _isBinaryFile(ext, filename) {
    const binaryExts = [
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
      '.ttf', '.otf', '.woff', '.woff2', '.eot',
      '.mp3', '.mp4', '.wav', '.ogg',
      '.pdf', '.zip', '.jar', '.so', '.dex',
      '.keystore', '.ks', '.apk', '.aab', '.ipa',
      '.wasm'
    ];
    
    if (binaryExts.includes(ext)) return true;
    
    // Check for common system files
    if (filename === '.DS_Store' || filename === 'Thumbs.db') return true;
    
    return false;
  }

  async saveFile(projectPath, filePath, content, binary = false) {
    const fullPath = path.join(projectPath, filePath);
    await fs.ensureDir(path.dirname(fullPath));
    
    if (binary) {
      // If content is base64
      if (typeof content === 'string' && content.length > 0) {
        await fs.writeFile(fullPath, Buffer.from(content, 'base64'));
      } else {
        await fs.writeFile(fullPath, content);
      }
    } else {
      await fs.writeFile(fullPath, content || '', 'utf-8');
    }
    
    return fullPath;
  }

  async uploadFiles(projectPath, files) {
    const results = [];
    
    for (const file of files) {
      try {
        const fullPath = path.join(projectPath, file.path);
        await fs.ensureDir(path.dirname(fullPath));
        
        if (file.binary) {
          await fs.writeFile(fullPath, Buffer.from(file.content, 'base64'));
        } else {
          await fs.writeFile(fullPath, file.content, 'utf-8');
        }
        
        results.push({ path: file.path, success: true });
      } catch (error) {
        results.push({ path: file.path, success: false, error: error.message });
      }
    }
    
    return results;
  }

  async deleteFile(projectPath, filePath) {
    const fullPath = path.join(projectPath, filePath);
    if (await fs.exists(fullPath)) {
      await fs.remove(fullPath);
      return true;
    }
    return false;
  }

  async watchProject(projectPath, callback) {
    if (this.watchers.has(projectPath)) {
      this.watchers.get(projectPath).close();
    }

    const chokidar = require('chokidar');
    const watcher = chokidar.watch(projectPath, {
      ignored: /(^|[\/\\])\..|node_modules/,
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('all', (event, filePath) => {
      const relativePath = path.relative(projectPath, filePath);
      callback(event, relativePath);
    });

    this.watchers.set(projectPath, watcher);
    return watcher;
  }

  async generateProjectStructure(projectPath) {
    await fs.ensureDir(projectPath);
    
    // Create www directory for the web files
    const webDir = path.join(projectPath, 'www');
    await fs.ensureDir(webDir);
    
    const structure = {
      'www/index.html': `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Capacitor App</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <div id="app">
      <header>
        <h1>🚀 My App</h1>
      </header>
      <main>
        <p>Welcome to your app built with Capacitor!</p>
        <button id="btnClick">Click here</button>
        <p id="message"></p>
      </main>
    </div>
    <script src="script.js"></script>
  </body>
  </html>`,
      
      'www/style.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  #app {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 16px;
    padding: 40px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    text-align: center;
  }

  header h1 {
    font-size: 28px;
    margin-bottom: 20px;
    color: #333;
  }

  main p {
    color: #666;
    font-size: 16px;
    line-height: 1.6;
    margin-bottom: 20px;
  }

  button {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    padding: 12px 30px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  button:hover {
    transform: scale(1.05);
    box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
  }

  button:active {
    transform: scale(0.95);
  }

  #message {
    margin-top: 16px;
    font-size: 14px;
    color: #764ba2;
    min-height: 24px;
  }`,
      
      'www/script.js': `// Main app
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnClick');
    const message = document.getElementById('message');
    
    btn.addEventListener('click', () => {
      const now = new Date();
      message.textContent = \`You clicked at \${now.toLocaleTimeString()}\`;
      message.style.animation = 'none';
      setTimeout(() => {
        message.style.animation = 'fadeIn 0.5s ease';
      }, 10);
    });
    
    console.log('🚀 App initialized successfully!');
  });

  // Dynamically add CSS animation
  const style = document.createElement('style');
  style.textContent = \`
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  \`;
  document.head.appendChild(style);`,
      
      'capacitor.config.json': JSON.stringify({
        appId: 'com.example.myapp',
        appName: 'My App',
        webDir: 'www',
        bundledWebRuntime: false,
        server: {
          androidScheme: 'https'
        }
      }, null, 2),
      
      'package.json': JSON.stringify({
        name: 'meu-app',
        version: '1.0.0',
        description: 'App created with CapacitorIA Studio',
        main: 'index.js',
        scripts: {
          'build': 'echo "Build the project"',
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
      }, null, 2)
    };

    for (const [filename, content] of Object.entries(structure)) {
      await this.saveFile(projectPath, filename, content, false);
    }

    return structure;
  }
}

module.exports = new FileService();