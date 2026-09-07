const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs-extra');

// Configuration
dotenv.config({ override: true });
const PORT = process.env.PORT || 3000;
const PROJECTS_ROOT = path.resolve(process.env.PROJECTS_ROOT || './projects');

// Import services
const buildService = require('./services/buildService');
const fileService = require('./services/fileService');

// Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ============================================================
// HELPER FUNCTION
// ============================================================

async function getActiveProject() {
  const activeFile = path.join(PROJECTS_ROOT, '.active');
  if (fs.existsSync(activeFile)) {
    const name = await fs.readFile(activeFile, 'utf-8');
    const projectPath = path.join(PROJECTS_ROOT, name.trim());
    if (fs.existsSync(projectPath)) {
      return { name: name.trim(), path: projectPath };
    }
  }
  
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.active') continue;
    
    const projectPath = path.join(PROJECTS_ROOT, entry.name);
    const hasCapConfig = fs.existsSync(path.join(projectPath, 'capacitor.config.json'));
    if (hasCapConfig) {
      return { name: entry.name, path: projectPath };
    }
  }
  
  return null;
}

function validateAppId(appId) {
  const regex = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
  return regex.test(appId);
}

// ============================================================
// API CONFIG - LOAD API KEY FROM .env
// ============================================================

app.get('/api/config', (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY || null;
    // Never send the full key to the client, just indicate if it exists
    res.json({ 
      hasApiKey: !!apiKey,
      apiKey: apiKey // Send the key for the client to use
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// OPENAI PROXY - SECURE ROUTE
// ============================================================

// Proxy for OpenAI models (server-side, secure)
app.get('/api/models', async (req, res) => {
  try {
    // Use the API key from environment variable
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return res.status(401).json({ error: 'OpenAI API key not configured in .env' });
    }
    
    console.log('🔑 Fetching models from OpenAI API...');
    
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ OpenAI API error:', errorData);
      return res.status(response.status).json({ 
        error: errorData.error?.message || 'Failed to fetch models' 
      });
    }
    
    const data = await response.json();
    console.log(`✅ Loaded ${data.data?.length || 0} models`);
    res.json(data);
  } catch (error) {
    console.error('❌ Error fetching models:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy for OpenAI chat completions (server-side, secure)
app.post('/api/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature = 0.7, max_tokens } = req.body;
    
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return res.status(401).json({ error: 'OpenAI API key not configured in .env' });
    }
    
    if (!model) {
      return res.status(400).json({ error: 'Model is required' });
    }
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages are required' });
    }
    
    console.log(`🤖 Calling OpenAI API with model: ${model}`);
    
    const requestBody = {
      model: model,
      messages: messages,
      temperature: temperature
    };
    
    if (max_tokens) {
      requestBody.max_tokens = max_tokens;
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ OpenAI API error:', errorData);
      return res.status(response.status).json({ 
        error: errorData.error?.message || 'OpenAI API request failed' 
      });
    }
    
    const data = await response.json();
    console.log('✅ OpenAI API response received');
    res.json(data);
  } catch (error) {
    console.error('❌ Error calling OpenAI API:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PROJECT MANAGEMENT ROUTES
// ============================================================

// List all projects
app.get('/api/projects', async (req, res) => {
  try {
    await fs.ensureDir(PROJECTS_ROOT);
    const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
    const projects = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.active') continue;
      
      const projectPath = path.join(PROJECTS_ROOT, entry.name);
      const hasCapConfig = fs.existsSync(path.join(projectPath, 'capacitor.config.json'));
      const hasPackageJson = fs.existsSync(path.join(projectPath, 'package.json'));
      const hasWww = fs.existsSync(path.join(projectPath, 'www'));
      
      if (hasCapConfig || hasPackageJson || hasWww) {
        const stat = await fs.stat(projectPath);
        const files = await fileService.getProjectFiles(projectPath);
        projects.push({
          name: entry.name,
          path: projectPath,
          hasCapConfig,
          hasPackageJson,
          hasWww,
          fileCount: files.length,
          created: stat.birthtime,
          modified: stat.mtime
        });
      }
    }
    
    res.json({ projects });
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new project
app.post('/api/projects', async (req, res) => {
  try {
    const { name, appName, appId } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const projectPath = path.join(PROJECTS_ROOT, sanitizedName);
    
    if (fs.existsSync(projectPath)) {
      return res.status(400).json({ error: 'Project already exists' });
    }
    
    await buildService.createCapacitorProject(
      projectPath,
      appName || name,
      appId || `com.example.${sanitizedName.replace(/-/g, '')}`
    );
    
    res.json({ 
      success: true, 
      path: projectPath,
      name: sanitizedName,
      message: 'Project created successfully!'
    });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import project from .zip
app.post('/api/projects/import', async (req, res) => {
  try {
    const { name, files } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files to import' });
    }
    
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const projectPath = path.join(PROJECTS_ROOT, sanitizedName);
    
    if (fs.existsSync(projectPath)) {
      return res.status(400).json({ error: 'Project already exists' });
    }
    
    await fs.ensureDir(projectPath);
    
    let fileCount = 0;
    let hasCapConfig = false;
    let hasPackageJson = false;
    let hasWww = false;
    
    for (const file of files) {
      const isBinary = file.binary || false;
      const content = file.content || '';
      const filePath = file.path || file.name;
      
      if (filePath === 'capacitor.config.json') hasCapConfig = true;
      if (filePath === 'package.json') hasPackageJson = true;
      if (filePath.startsWith('www/')) hasWww = true;
      
      await fileService.saveFile(projectPath, filePath, content, isBinary);
      fileCount++;
    }
    
    if (!hasWww) {
      const wwwPath = path.join(projectPath, 'www');
      await fs.ensureDir(wwwPath);
      
      const rootFiles = ['index.html', 'style.css', 'script.js'];
      for (const rf of rootFiles) {
        const srcPath = path.join(projectPath, rf);
        if (fs.existsSync(srcPath)) {
          const destPath = path.join(wwwPath, rf);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
      }
    }
    
    if (!hasCapConfig) {
      const config = {
        appId: `com.example.${sanitizedName.replace(/-/g, '')}`,
        appName: name,
        webDir: 'www',
        bundledWebRuntime: false,
        server: {
          androidScheme: 'https'
        }
      };
      await fs.writeJson(path.join(projectPath, 'capacitor.config.json'), config, { spaces: 2 });
    }
    
    if (!hasPackageJson) {
      const packageJson = {
        name: sanitizedName,
        version: '1.0.0',
        description: 'App imported into CapacitorIA Studio',
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
      };
      await fs.writeJson(path.join(projectPath, 'package.json'), packageJson, { spaces: 2 });
    }
    
    res.json({ 
      success: true, 
      path: projectPath,
      name: sanitizedName,
      fileCount,
      message: `Project imported with ${fileCount} files!`
    });
  } catch (error) {
    console.error('Error importing project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete project
app.delete('/api/projects/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const projectPath = path.join(PROJECTS_ROOT, name);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    await fs.remove(projectPath);
    
    const activeFile = path.join(PROJECTS_ROOT, '.active');
    if (fs.existsSync(activeFile)) {
      const active = await fs.readFile(activeFile, 'utf-8');
      if (active.trim() === name) {
        await fs.remove(activeFile);
      }
    }
    
    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete all projects
app.delete('/api/projects', async (req, res) => {
  try {
    const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
    let count = 0;
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.active') continue;
      
      const projectPath = path.join(PROJECTS_ROOT, entry.name);
      await fs.remove(projectPath);
      count++;
    }
    
    const activeFile = path.join(PROJECTS_ROOT, '.active');
    if (fs.existsSync(activeFile)) {
      await fs.remove(activeFile);
    }
    
    res.json({ success: true, message: `${count} projects deleted` });
  } catch (error) {
    console.error('Error deleting projects:', error);
    res.status(500).json({ error: error.message });
  }
});

// Select active project
app.post('/api/projects/select', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    const projectPath = path.join(PROJECTS_ROOT, name);
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const hasCapConfig = fs.existsSync(path.join(projectPath, 'capacitor.config.json'));
    if (!hasCapConfig) {
      const config = {
        appId: `com.example.${name.replace(/-/g, '')}`,
        appName: name,
        webDir: 'www',
        bundledWebRuntime: false,
        server: {
          androidScheme: 'https'
        }
      };
      await fs.writeJson(path.join(projectPath, 'capacitor.config.json'), config, { spaces: 2 });
    }
    
    await fs.writeFile(path.join(PROJECTS_ROOT, '.active'), name);
    
    res.json({ 
      success: true, 
      path: projectPath,
      name,
      message: `Project ${name} selected`
    });
  } catch (error) {
    console.error('Error selecting project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get active project
app.get('/api/projects/active', async (req, res) => {
  try {
    const activeFile = path.join(PROJECTS_ROOT, '.active');
    if (fs.existsSync(activeFile)) {
      const name = await fs.readFile(activeFile, 'utf-8');
      const projectPath = path.join(PROJECTS_ROOT, name.trim());
      if (fs.existsSync(projectPath)) {
        return res.json({ 
          name: name.trim(),
          path: projectPath
        });
      }
    }
    
    const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.active') continue;
      
      const projectPath = path.join(PROJECTS_ROOT, entry.name);
      const hasCapConfig = fs.existsSync(path.join(projectPath, 'capacitor.config.json'));
      if (hasCapConfig) {
        return res.json({ 
          name: entry.name,
          path: projectPath
        });
      }
    }
    
    res.json({ name: null, path: null });
  } catch (error) {
    console.error('Error getting active project:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PROJECT FILES
// ============================================================

// Get files from active project
app.get('/api/project/files', async (req, res) => {
  try {
    const active = await getActiveProject();
    if (!active) {
      return res.json({ files: [], project: null });
    }
    
    const files = await fileService.getProjectFiles(active.path);
    res.json({ files, project: active });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save file in active project
app.post('/api/project/files', async (req, res) => {
  try {
    const { path: filePath, content, binary } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const active = await getActiveProject();
    if (!active) {
      return res.status(404).json({ error: 'No active project' });
    }
    
    const fullPath = await fileService.saveFile(active.path, filePath, content, binary);
    res.json({ success: true, path: fullPath });
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete file from active project
app.delete('/api/project/files', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const active = await getActiveProject();
    if (!active) {
      return res.status(404).json({ error: 'No active project' });
    }
    
    await fileService.deleteFile(active.path, filePath);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// FILE CONTENT
// ============================================================

// Get file content
app.get('/api/project/file-content/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const { path: filePath } = req.query;
    
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    const fullPath = path.join(projectPath, filePath);
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const content = await fs.readFile(fullPath, 'utf-8');
    res.json({ content, path: filePath });
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update file content
app.put('/api/project/file-content/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const { path: filePath, content } = req.body;
    
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    const fullPath = path.join(projectPath, filePath);
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    await fs.writeFile(fullPath, content, 'utf-8');
    res.json({ success: true, path: filePath });
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PROJECT CONFIGURATION
// ============================================================

// Get project configuration
app.get('/api/projects/:name/config', async (req, res) => {
  try {
    const { name } = req.params;
    const projectPath = path.join(PROJECTS_ROOT, name);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const configPath = path.join(projectPath, 'capacitor.config.json');
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: 'capacitor.config.json not found' });
    }
    
    const config = await fs.readJson(configPath);
    
    const packageJsonPath = path.join(projectPath, 'package.json');
    let packageJson = null;
    if (fs.existsSync(packageJsonPath)) {
      packageJson = await fs.readJson(packageJsonPath);
    }
    
    res.json({ config, packageJson });
  } catch (error) {
    console.error('Error getting configuration:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update project configuration
app.put('/api/projects/:name/config', async (req, res) => {
  try {
    const { name } = req.params;
    const { 
      appId, 
      appName, 
      webDir,
      versionCode,
      versionName,
      compileSdkVersion,
      minSdkVersion,
      targetSdkVersion,
      compileSdkVersionCodename
    } = req.body;
    
    const projectPath = path.join(PROJECTS_ROOT, name);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const configPath = path.join(projectPath, 'capacitor.config.json');
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: 'capacitor.config.json not found' });
    }
    
    const config = await fs.readJson(configPath);
    
    if (appId) config.appId = appId;
    if (appName) config.appName = appName;
    if (webDir) config.webDir = webDir;
    
    if (!config.android) config.android = {};
    if (!config.ios) config.ios = {};
    
    if (versionCode) config.android.versionCode = parseInt(versionCode);
    if (versionName) config.android.versionName = versionName;
    if (compileSdkVersion) config.android.compileSdkVersion = parseInt(compileSdkVersion);
    if (minSdkVersion) config.android.minSdkVersion = parseInt(minSdkVersion);
    if (targetSdkVersion) config.android.targetSdkVersion = parseInt(targetSdkVersion);
    if (compileSdkVersionCodename) config.android.compileSdkVersionCodename = compileSdkVersionCodename;
    
    await fs.writeJson(configPath, config, { spaces: 2 });
    
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      if (appId) {
        const parts = appId.split('.');
        const name = parts[parts.length - 1] || 'app';
        packageJson.name = name;
      }
      if (versionName) packageJson.version = versionName;
      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
    }
    
    const gradlePath = path.join(projectPath, 'android/app/build.gradle');
    if (fs.existsSync(gradlePath) && appId) {
      let gradleContent = await fs.readFile(gradlePath, 'utf-8');
      
      if (appId) {
        gradleContent = gradleContent.replace(
          /applicationId\s+["'](.*?)["']/,
          `applicationId "${appId}"`
        );
        gradleContent = gradleContent.replace(
          /namespace\s+["'](.*?)["']/,
          `namespace "${appId}"`
        );
      }
      
      if (versionCode) {
        gradleContent = gradleContent.replace(
          /versionCode\s+(\d+)/,
          `versionCode ${versionCode}`
        );
      }
      
      if (versionName) {
        gradleContent = gradleContent.replace(
          /versionName\s+["'](.*?)["']/,
          `versionName "${versionName}"`
        );
      }
      
      if (compileSdkVersion) {
        gradleContent = gradleContent.replace(
          /compileSdkVersion\s+(\d+)/,
          `compileSdkVersion ${compileSdkVersion}`
        );
      }
      
      if (minSdkVersion) {
        gradleContent = gradleContent.replace(
          /minSdkVersion\s+(\d+)/,
          `minSdkVersion ${minSdkVersion}`
        );
      }
      
      if (targetSdkVersion) {
        gradleContent = gradleContent.replace(
          /targetSdkVersion\s+(\d+)/,
          `targetSdkVersion ${targetSdkVersion}`
        );
      }
      
      if (compileSdkVersionCodename) {
        gradleContent = gradleContent.replace(
          /compileSdkVersionCodename\s+["'](.*?)["']/,
          `compileSdkVersionCodename "${compileSdkVersionCodename}"`
        );
      }
      
      await fs.writeFile(gradlePath, gradleContent);
      console.log(`📝 Updated build.gradle with new settings`);
    }
    
    res.json({
      success: true,
      message: 'Configuration updated successfully!',
      config
    });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// VISUAL EDITING
// ============================================================

// Apply visual edits
app.post('/api/project/visual-edit', async (req, res) => {
  try {
    const { path: filePath, selector, changes } = req.body;
    
    const active = await getActiveProject();
    if (!active) {
      return res.status(404).json({ error: 'No active project' });
    }
    
    const fullPath = path.join(active.path, filePath || 'www/index.html');
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    let content = await fs.readFile(fullPath, 'utf-8');
    
    for (const change of changes) {
      if (change.type === 'text') {
        const regex = new RegExp(`(<${change.tag}[^>]*>)(.*?)(</${change.tag}>)`, 'g');
        content = content.replace(regex, (match, open, text, close) => {
          if (text.includes(change.oldText)) {
            return open + change.newText + close;
          }
          return match;
        });
      } else if (change.type === 'style') {
        const styleRegex = /<style>([\s\S]*?)<\/style>/;
        const match = content.match(styleRegex);
        if (match) {
          let css = match[1];
          css += `\n${change.selector} { ${change.properties} }`;
          content = content.replace(styleRegex, `<style>${css}</style>`);
        } else {
          content = content.replace('</head>', `<style>${change.selector} { ${change.properties} }</style>\n</head>`);
        }
      } else if (change.type === 'javascript') {
        const scriptRegex = /<script>([\s\S]*?)<\/script>/;
        const match = content.match(scriptRegex);
        if (match) {
          let js = match[1];
          js += `\n// ${change.description}\n${change.code}`;
          content = content.replace(scriptRegex, `<script>${js}</script>`);
        } else {
          content = content.replace('</body>', `<script>${change.code}</script>\n</body>`);
        }
      } else if (change.type === 'attribute') {
        const regex = new RegExp(`<${change.tag}([^>]*)>`, 'g');
        content = content.replace(regex, (match, attrs) => {
          if (attrs.includes(change.attribute)) {
            return match;
          }
          return `<${change.tag} ${change.attribute}="${change.value}"${attrs}>`;
        });
      }
    }
    
    await fs.writeFile(fullPath, content, 'utf-8');
    
    res.json({ 
      success: true, 
      message: 'Visual changes applied successfully!',
      file: filePath
    });
  } catch (error) {
    console.error('Error applying visual edit:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ELEMENT REFERENCES
// ============================================================

app.get('/api/project/element-references/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const { elementId, elementClass, elementTag } = req.query;
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const references = {
      javascript: [],
      css: [],
      html: []
    };
    
    const files = await fileService.getProjectFiles(projectPath);
    
    for (const file of files) {
      if (file.isBinary) continue;
      
      const ext = path.extname(file.path).toLowerCase();
      if (!['.js', '.css', '.html', '.htm'].includes(ext)) continue;
      
      const content = file.content || '';
      let found = false;
      let matches = [];
      
      if (elementId) {
        const idPattern = new RegExp(`(['"])${elementId}\\1|#${elementId}|getElementById\\(['"]${elementId}['"]\\)`, 'gi');
        if (idPattern.test(content)) {
          found = true;
          matches.push(`ID: ${elementId}`);
        }
      }
      
      if (elementClass) {
        const classPattern = new RegExp(`\\.${elementClass}|getElementsByClassName\\(['"]${elementClass}['"]\\)|classList\\.(?:add|remove|toggle)\\(['"]${elementClass}['"]\\)`, 'gi');
        if (classPattern.test(content)) {
          found = true;
          matches.push(`Class: ${elementClass}`);
        }
      }
      
      if (elementTag) {
        const tagPattern = new RegExp(`<${elementTag}[^>]*>|document\\.getElementsByTagName\\(['"]${elementTag}['"]\\)|querySelector\\(['"]${elementTag}['"]\\)`, 'gi');
        if (tagPattern.test(content)) {
          found = true;
          matches.push(`Tag: ${elementTag}`);
        }
      }
      
      if (found) {
        const type = ext === '.js' ? 'javascript' : ext === '.css' ? 'css' : 'html';
        references[type].push({
          file: file.path,
          matches: matches,
          content: content.substring(0, 500)
        });
      }
    }
    
    res.json({ references });
  } catch (error) {
    console.error('Error searching references:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ASSETS
// ============================================================

app.get('/api/project/assets/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const assets = [];
    const assetDir = path.join(projectPath, 'assets');
    
    if (fs.existsSync(assetDir)) {
      const walkDir = async (dir, basePath) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(basePath, entry.name);
          if (entry.isDirectory()) {
            await walkDir(fullPath, relativePath);
          } else {
            const stat = await fs.stat(fullPath);
            const ext = path.extname(entry.name).toLowerCase();
            const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext);
            const isVideo = ['.mp4', '.webm', '.ogg', '.mov'].includes(ext);
            const isAnimation = ['.gif', '.json', '.lottie'].includes(ext);
            
            assets.push({
              name: entry.name,
              path: relativePath,
              fullPath: fullPath,
              size: stat.size,
              type: isImage ? 'image' : isVideo ? 'video' : isAnimation ? 'animation' : 'other',
              modified: stat.mtime
            });
          }
        }
      };
      await walkDir(assetDir, 'assets');
    }
    
    res.json({ assets });
  } catch (error) {
    console.error('Error listing assets:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// VERSIONS
// ============================================================

app.get('/api/project/versions/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const versions = {
      capacitor: {},
      android: {},
      ios: {},
      sdk: {}
    };
    
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      if (deps['@capacitor/core']) versions.capacitor.core = deps['@capacitor/core'];
      if (deps['@capacitor/cli']) versions.capacitor.cli = deps['@capacitor/cli'];
      if (deps['@capacitor/android']) versions.android.capacitor = deps['@capacitor/android'];
      if (deps['@capacitor/ios']) versions.ios.capacitor = deps['@capacitor/ios'];
    }
    
    const configPath = path.join(projectPath, 'capacitor.config.json');
    if (fs.existsSync(configPath)) {
      const config = await fs.readJson(configPath);
      if (config.android) {
        versions.android.compileSdkVersion = config.android.compileSdkVersion || '35';
        versions.android.minSdkVersion = config.android.minSdkVersion || '23';
        versions.android.targetSdkVersion = config.android.targetSdkVersion || '35';
        versions.android.versionCode = config.android.versionCode || '1';
        versions.android.versionName = config.android.versionName || '1.0.0';
      }
    }
    
    const gradlePath = path.join(projectPath, 'android/app/build.gradle');
    if (fs.existsSync(gradlePath)) {
      const gradleContent = await fs.readFile(gradlePath, 'utf-8');
      
      const compileSdkMatch = gradleContent.match(/compileSdkVersion\s+(\d+)/);
      if (compileSdkMatch) versions.sdk.compileSdkVersion = compileSdkMatch[1];
      
      const minSdkMatch = gradleContent.match(/minSdkVersion\s+(\d+)/);
      if (minSdkMatch) versions.sdk.minSdkVersion = minSdkMatch[1];
      
      const targetSdkMatch = gradleContent.match(/targetSdkVersion\s+(\d+)/);
      if (targetSdkMatch) versions.sdk.targetSdkVersion = targetSdkMatch[1];
    }
    
    try {
      const npmResponse = await fetch('https://registry.npmjs.org/@capacitor/core/latest');
      if (npmResponse.ok) {
        const npmData = await npmResponse.json();
        versions.latestCapacitorVersion = npmData.version;
      }
    } catch (error) {
      console.warn('Error fetching latest Capacitor version:', error);
    }
    
    const targetSdk = parseInt(versions.sdk.targetSdkVersion || versions.android.targetSdkVersion || '35');
    const compileSdk = parseInt(versions.sdk.compileSdkVersion || versions.android.compileSdkVersion || '35');
    
    versions.compatibility = {
      targetSdk: targetSdk,
      compileSdk: compileSdk,
      isAndroid15Compatible: targetSdk >= 35 && compileSdk >= 35,
      requiresUpdate: targetSdk < 35 || compileSdk < 35,
      message: targetSdk >= 35 && compileSdk >= 35 
        ? '✅ Compatible with Android 15 (API 35)'
        : '⚠️ Update to API 35 for Android 15 compatibility'
    };
    
    res.json(versions);
  } catch (error) {
    console.error('Error getting versions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update Capacitor
app.post('/api/project/update-capacitor/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const { version } = req.body;
    
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return res.status(404).json({ error: 'package.json not found' });
    }
    
    const packageJson = await fs.readJson(packageJsonPath);
    
    if (!packageJson.dependencies) packageJson.dependencies = {};
    if (!packageJson.devDependencies) packageJson.devDependencies = {};
    
    const targetVersion = version || 'latest';
    const deps = ['@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios'];
    
    for (const dep of deps) {
      if (packageJson.dependencies[dep]) {
        packageJson.dependencies[dep] = targetVersion;
      }
      if (packageJson.devDependencies[dep]) {
        packageJson.devDependencies[dep] = targetVersion;
      }
    }
    
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
    
    const configPath = path.join(projectPath, 'capacitor.config.json');
    if (fs.existsSync(configPath)) {
      const config = await fs.readJson(configPath);
      if (!config.android) config.android = {};
      
      config.android.compileSdkVersion = 35;
      config.android.targetSdkVersion = 35;
      config.android.minSdkVersion = config.android.minSdkVersion || 23;
      
      await fs.writeJson(configPath, config, { spaces: 2 });
    }
    
    res.json({
      success: true,
      message: `Capacitor updated to ${targetVersion} successfully!`,
      version: targetVersion
    });
  } catch (error) {
    console.error('Error updating Capacitor:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// BUILD
// ============================================================

app.get('/api/builds/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const builds = {
      apk: [],
      aab: [],
      ipa: []
    };
    
    const apkPaths = [
      path.join(projectPath, 'android/app/build/outputs/apk/debug'),
      path.join(projectPath, 'android/app/build/outputs/apk/release'),
      path.join(projectPath, 'android/app/build/outputs/apk')
    ];
    
    for (const apkDir of apkPaths) {
      if (fs.existsSync(apkDir)) {
        const files = await fs.readdir(apkDir);
        for (const file of files) {
          if (file.endsWith('.apk')) {
            const fullPath = path.join(apkDir, file);
            const stat = await fs.stat(fullPath);
            builds.apk.push({
              name: file,
              path: fullPath,
              size: stat.size,
              modified: stat.mtime,
              type: apkDir.includes('debug') ? 'debug' : 'release'
            });
          }
        }
      }
    }
    
    const aabPaths = [
      path.join(projectPath, 'android/app/build/outputs/bundle/release'),
      path.join(projectPath, 'android/app/build/outputs/bundle/debug'),
      path.join(projectPath, 'android/app/build/outputs/bundle')
    ];
    
    for (const aabDir of aabPaths) {
      if (fs.existsSync(aabDir)) {
        const files = await fs.readdir(aabDir);
        for (const file of files) {
          if (file.endsWith('.aab')) {
            const fullPath = path.join(aabDir, file);
            const stat = await fs.stat(fullPath);
            builds.aab.push({
              name: file,
              path: fullPath,
              size: stat.size,
              modified: stat.mtime
            });
          }
        }
      }
    }
    
    const iosPaths = [
      path.join(projectPath, 'ios/build'),
      path.join(projectPath, 'ios')
    ];
    
    for (const iosDir of iosPaths) {
      if (fs.existsSync(iosDir)) {
        const findIpa = async (dir) => {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await findIpa(fullPath);
            } else if (entry.name.endsWith('.ipa')) {
              const stat = await fs.stat(fullPath);
              builds.ipa.push({
                name: entry.name,
                path: fullPath,
                size: stat.size,
                modified: stat.mtime
              });
            }
          }
        };
        await findIpa(iosDir);
      }
    }
    
    res.json({ builds, project: projectName });
  } catch (error) {
    console.error('Error listing builds:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/download/build', async (req, res) => {
  try {
    const { file } = req.query;
    if (!file) {
      return res.status(400).json({ error: 'File not specified' });
    }
    
    const fullPath = path.resolve(file);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const allowedExts = ['.apk', '.aab', '.ipa'];
    const ext = path.extname(fullPath);
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ error: 'File type not allowed' });
    }
    
    const fileName = path.basename(fullPath);
    res.download(fullPath, fileName);
  } catch (error) {
    console.error('Error during download:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/build/status/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const apkPaths = [
      path.join(projectPath, 'android/app/build/outputs/apk/debug/app-debug.apk'),
      path.join(projectPath, 'android/app/build/outputs/apk/release/app-release.apk')
    ];
    
    let apkExists = false;
    let apkPath = null;
    let apkSize = 0;
    
    for (const apkPathCheck of apkPaths) {
      if (fs.existsSync(apkPathCheck)) {
        apkExists = true;
        apkPath = apkPathCheck;
        const stat = await fs.stat(apkPathCheck);
        apkSize = stat.size;
        break;
      }
    }
    
    const aabPath = path.join(projectPath, 'android/app/build/outputs/bundle/release/app-release.aab');
    let aabExists = fs.existsSync(aabPath);
    
    res.json({
      project: projectName,
      apk: {
        exists: apkExists,
        path: apkPath,
        size: apkSize,
        sizeFormatted: apkSize > 0 ? (apkSize / 1024 / 1024).toFixed(2) + ' MB' : '0 MB'
      },
      aab: {
        exists: aabExists,
        path: aabPath
      }
    });
  } catch (error) {
    console.error('Error checking build status:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// AI EDIT - SECURE ROUTE
// ============================================================

app.post('/api/project/edit-with-ai/:projectName', async (req, res) => {
  try {
    const { projectName } = req.params;
    const { filePath, componentSelector, currentCode, prompt, apiKey } = req.body;
    
    // Use the server's API key if not provided by client
    const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
    
    if (!effectiveApiKey) {
      return res.status(400).json({ error: 'OpenAI API key is required' });
    }
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    
    console.log('📝 AI Edit request for project:', projectName);
    console.log('📄 File:', filePath);
    console.log('🎯 Component:', componentSelector);
    console.log('🔑 Using API key:', effectiveApiKey.substring(0, 10) + '...');
    
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    const fullPath = path.join(projectPath, filePath);
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found: ' + filePath });
    }
    
    const fullContent = await fs.readFile(fullPath, 'utf-8');
    console.log('📖 File loaded, size:', fullContent.length);
    
    const systemPrompt = `You are an expert developer. Modify ONLY the code that references the component with selector "${componentSelector}" in the file below.
Return ONLY the complete updated file content, no explanations, no markdown, no code blocks.

Rules:
1. Find the code that references the component with selector "${componentSelector}"
2. Make the requested changes ONLY to that specific code
3. Keep all other code unchanged
4. Return the COMPLETE file content after modification
5. Do not add any extra text, comments, or formatting outside the code`;

    const userPrompt = `File content:\n${fullContent}\n\nUser request: ${prompt}\n\nComponent selector: "${componentSelector}"\n\nReturn the complete updated file content.`;

    console.log('🤖 Calling OpenAI API...');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${effectiveApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ OpenAI API error:', errorData);
      return res.status(response.status).json({ 
        error: errorData.error?.message || 'AI request failed' 
      });
    }

    const data = await response.json();
    const updatedCode = data.choices[0].message.content;
    console.log('✅ AI response received, code length:', updatedCode.length);

    res.json({ 
      success: true, 
      updatedCode,
      message: 'Code updated successfully with AI'
    });
  } catch (error) {
    console.error('❌ Error editing with AI:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// WEBSOCKET
// ============================================================

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'build':
          const { platform, projectName } = data;
          
          let buildPath;
          if (projectName) {
            buildPath = path.join(PROJECTS_ROOT, projectName);
          } else {
            const active = await getActiveProject();
            buildPath = active ? active.path : PROJECTS_ROOT;
          }
          
          console.log(`📦 Build requested for: ${buildPath}`);
          console.log(`📱 Platform: ${platform}`);
          
          if (!fs.existsSync(buildPath)) {
            ws.send(JSON.stringify({
              type: 'build-error',
              error: `Project not found at: ${buildPath}`
            }));
            return;
          }
          
          try {
            await buildService.runBuild(buildPath, platform, (progress) => {
              ws.send(JSON.stringify({
                type: 'build-progress',
                ...progress
              }));
            });
          } catch (buildError) {
            console.error('❌ Build error:', buildError);
            ws.send(JSON.stringify({
              type: 'build-error',
              error: buildError.message
            }));
          }
          break;
          
        default:
          console.log('Unknown message:', data);
      }
    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({
        type: 'build-error',
        error: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// ============================================================
// PREVIEW
// ============================================================

app.use('/preview', express.static(PROJECTS_ROOT));

app.get('/preview/:project/*', (req, res) => {
  const { project, 0: filePath } = req.params;
  const fullPath = path.join(PROJECTS_ROOT, project, filePath || 'www/index.html');
  
  if (fs.existsSync(fullPath)) {
    res.sendFile(fullPath);
  } else {
    const rootPath = path.join(PROJECTS_ROOT, project, 'index.html');
    if (fs.existsSync(rootPath)) {
      res.sendFile(rootPath);
    } else {
      res.status(404).send(`
        <html>
          <body style="font-family:sans-serif;padding:40px;text-align:center;background:#0F1117;color:#EEF0F7;">
            <h1>📄 File not found</h1>
            <p>File: ${filePath || 'index.html'}</p>
            <p>Project: ${project}</p>
          </body>
        </html>
      `);
    }
  }
});

app.get('/preview/:project/assets/*', async (req, res) => {
  try {
    const { project, 0: assetPath } = req.params;
    const fullPath = path.join(PROJECTS_ROOT, project, 'assets', assetPath);
    
    if (fs.existsSync(fullPath)) {
      res.sendFile(fullPath);
    } else {
      res.status(404).json({ error: 'Asset not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// START SERVER
// ============================================================

async function initServer() {
  await fs.ensureDir(PROJECTS_ROOT);
  console.log(`📁 Projects directory: ${PROJECTS_ROOT}`);
  
  // Check if OpenAI API key is configured
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    console.log(`🔑 OpenAI API key configured (${apiKey.substring(0, 10)}...)`);
  } else {
    console.log('⚠️ OpenAI API key not configured in .env');
  }
  
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  let hasValidProject = false;
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.active') continue;
    
    const projectPath = path.join(PROJECTS_ROOT, entry.name);
    const hasCapConfig = fs.existsSync(path.join(projectPath, 'capacitor.config.json'));
    if (hasCapConfig) {
      hasValidProject = true;
      break;
    }
  }
  
  if (!hasValidProject) {
    console.log('📦 Creating initial project...');
    await buildService.createCapacitorProject(
      path.join(PROJECTS_ROOT, 'meu-app'),
      'My App',
      'com.example.myapp'
    );
    console.log('✅ Initial project created!');
  }
  
  server.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`📁 Projects at: ${PROJECTS_ROOT}`);
    console.log(`📱 Preview available at: http://localhost:${PORT}/preview`);
    console.log(`\n💡 Instructions:`);
    console.log(`  1. Go to http://localhost:${PORT}`);
    console.log(`  2. Create or select a project`);
    console.log(`  3. Edit the files in the "Project" tab`);
    console.log(`  4. Click "Build" to compile`);
    console.log(`\n`);
  });
}

initServer();