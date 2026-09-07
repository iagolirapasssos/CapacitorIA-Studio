// Cliente WebSocket para comunicação com o servidor
class CapacitorIAStudio {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.buildInProgress = false;
    this.projectFiles = [];
    this.currentFile = null;
    this.editor = null;
    this.init();
  }

  init() {
    this.connectWebSocket();
    this.setupEventListeners();
    this.loadProjectFiles();
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('Conectado ao servidor WebSocket');
      this.isConnected = true;
      this.updateStatus('Conectado', 'ok');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleWebSocketMessage(data);
      } catch (error) {
        console.error('Erro ao processar mensagem:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('Desconectado do servidor WebSocket');
      this.isConnected = false;
      this.updateStatus('Desconectado', 'err');
      
      // Tentar reconectar após 3 segundos
      setTimeout(() => this.connectWebSocket(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('Erro no WebSocket:', error);
    };
  }

  handleWebSocketMessage(data) {
    switch (data.type) {
      case 'build-progress':
        this.updateBuildProgress(data);
        break;
      case 'build-complete':
        this.handleBuildComplete(data);
        break;
      case 'build-error':
        this.handleBuildError(data);
        break;
      case 'file-changed':
        this.handleFileChange(data);
        break;
      default:
        console.log('Mensagem recebida:', data);
    }
  }

  updateBuildProgress(data) {
    const progressBar = document.getElementById('buildProgress');
    const progressText = document.getElementById('buildProgressText');
    
    if (progressBar && progressText) {
      const percent = (data.step / data.total) * 100;
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${data.step}/${data.total}: ${data.message}`;
    }
  }

  handleBuildComplete(data) {
    this.buildInProgress = false;
    this.updateStatus('Build concluído', 'ok');
    this.showToast(`Build ${data.platform} concluído com sucesso!`, 'ok');
    
    // Botão de download do APK/AAB
    if (data.outputPath) {
      // Adicionar botão de download
    }
  }

  handleBuildError(data) {
    this.buildInProgress = false;
    this.updateStatus('Erro no build', 'err');
    this.showToast(`Erro: ${data.error}`, 'err');
  }

  handleFileChange(data) {
    // Recarregar a lista de arquivos
    this.loadProjectFiles();
    
    // Se o arquivo atual foi alterado, recarregar
    if (this.currentFile && data.path === this.currentFile.path) {
      this.loadFileContent(data.path);
    }
  }

  updateStatus(status, type) {
    const statusEl = document.getElementById('statusText');
    const dotEl = document.getElementById('statusDot');
    
    if (statusEl) statusEl.textContent = status;
    if (dotEl) {
      dotEl.className = 'status-dot';
      if (type === 'ok') dotEl.classList.add('on');
      if (type === 'err') dotEl.style.background = 'var(--danger)';
    }
  }

  showToast(message, type) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.className = `toast show ${type || ''}`;
      clearTimeout(toast._timeout);
      toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
  }

  setupEventListeners() {
    // Botão de build
    document.getElementById('btnBuild').addEventListener('click', () => {
      this.startBuild();
    });

    // Botão de preview
    document.getElementById('btnPreview').addEventListener('click', () => {
      this.openPreview();
    });

    // Editor
    const editorEl = document.getElementById('editor');
    if (editorEl) {
      // Inicializar editor (CodeMirror ou simples textarea)
    }
  }

  startBuild() {
    if (this.buildInProgress) return;
    
    const platform = document.getElementById('buildPlatform').value;
    if (!platform) {
      this.showToast('Selecione uma plataforma para build', 'err');
      return;
    }

    this.buildInProgress = true;
    this.updateStatus(`Build ${platform} iniciado...`, '');
    
    // Enviar comando via WebSocket
    this.ws.send(JSON.stringify({
      type: 'build',
      platform: platform,
      projectPath: './projects/current'
    }));

    // Mostrar progresso
    const progressContainer = document.getElementById('buildProgressContainer');
    if (progressContainer) {
      progressContainer.style.display = 'block';
    }
  }

  openPreview() {
    // Abrir preview em nova aba
    const previewUrl = `/preview/index.html`;
    window.open(previewUrl, '_blank');
  }

  async loadProjectFiles() {
    try {
      const response = await fetch('/api/project/files');
      const data = await response.json();
      
      if (data.files) {
        this.projectFiles = data.files;
        this.renderFileTree(data.files);
      }
    } catch (error) {
      console.error('Erro ao carregar arquivos:', error);
    }
  }

  renderFileTree(files) {
    const treeContainer = document.getElementById('fileTree');
    if (!treeContainer) return;
    
    // Construir árvore
    const tree = this.buildTree(files);
    treeContainer.innerHTML = this.renderTreeHTML(tree);
    
    // Adicionar event listeners
    treeContainer.querySelectorAll('.file-item').forEach(el => {
      el.addEventListener('click', () => {
        const path = el.dataset.path;
        if (path) {
          this.openFile(path);
        }
      });
    });
  }

  buildTree(files) {
    const tree = {};
    
    for (const file of files) {
      const parts = file.path.split('/');
      let current = tree;
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          // É um arquivo
          current[part] = { ...file, isFile: true };
        } else {
          // É uma pasta
          if (!current[part]) {
            current[part] = { _children: {} };
          }
          current = current[part]._children;
        }
      }
    }
    
    return tree;
  }

  renderTreeHTML(tree, basePath = '') {
    let html = '<ul class="tree">';
    
    for (const [name, data] of Object.entries(tree)) {
      const currentPath = basePath ? `${basePath}/${name}` : name;
      
      if (data.isFile) {
        const icon = this.getFileIcon(data.path);
        html += `
          <li class="file-item" data-path="${currentPath}">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${name}</span>
          </li>
        `;
      } else {
        const children = data._children || {};
        const hasChildren = Object.keys(children).length > 0;
        
        html += `
          <li class="folder-item">
            <span class="folder-toggle" onclick="this.parentElement.querySelector('.folder-children').classList.toggle('hidden')">
              📁 ${name}
            </span>
            ${hasChildren ? `<ul class="folder-children">${this.renderTreeHTML(children, currentPath)}</ul>` : '<ul class="folder-children empty"><li>Pasta vazia</li></ul>'}
          </li>
        `;
      }
    }
    
    html += '</ul>';
    return html;
  }

  getFileIcon(path) {
    const ext = path.split('.').pop().toLowerCase();
    const icons = {
      'html': '🌐',
      'css': '🎨',
      'js': '⚡',
      'json': '📋',
      'md': '📝',
      'txt': '📄',
      'png': '🖼️',
      'jpg': '🖼️',
      'jpeg': '🖼️',
      'gif': '🖼️',
      'svg': '🖼️',
      'ico': '🖼️',
      'ttf': '🔤',
      'otf': '🔤',
      'woff': '🔤',
      'woff2': '🔤',
      'eot': '🔤',
      'mp3': '🎵',
      'mp4': '🎬',
      'pdf': '📕',
      'zip': '📦'
    };
    return icons[ext] || '📄';
  }

  async openFile(path) {
    try {
      const response = await fetch(`/api/project/files/${encodeURIComponent(path)}`);
      const data = await response.json();
      
      if (data.file) {
        this.currentFile = data.file;
        this.loadFileIntoEditor(data.file);
      }
    } catch (error) {
      console.error('Erro ao abrir arquivo:', error);
    }
  }

  loadFileIntoEditor(file) {
    const editorEl = document.getElementById('editor');
    const previewEl = document.getElementById('editorPreview');
    
    if (!editorEl) return;
    
    if (file.isBinary) {
      editorEl.style.display = 'none';
      if (previewEl) {
        previewEl.style.display = 'block';
        // Mostrar preview da imagem se for imagem
        if (file.mimeType.startsWith('image/')) {
          previewEl.innerHTML = `<img src="data:${file.mimeType};base64,${file.content}" alt="${file.name}">`;
        } else {
          previewEl.innerHTML = `<p>Arquivo binário: ${file.name}</p>`;
        }
      }
    } else {
      editorEl.style.display = 'block';
      if (previewEl) previewEl.style.display = 'none';
      
      editorEl.value = file.content || '';
      
      // Configurar modo do editor baseado na extensão
      const mode = this.getEditorMode(file.path);
      // Aqui configurar o CodeMirror ou Monaco
    }
  }

  getEditorMode(path) {
    const ext = path.split('.').pop().toLowerCase();
    const modes = {
      'html': 'html',
      'css': 'css',
      'js': 'javascript',
      'json': 'json',
      'md': 'markdown'
    };
    return modes[ext] || 'text';
  }

  async saveFile() {
    if (!this.currentFile) return;
    
    const editorEl = document.getElementById('editor');
    if (!editorEl) return;
    
    const content = editorEl.value;
    
    try {
      await fetch('/api/project/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: this.currentFile.path,
          content: content
        })
      });
      
      this.showToast('Arquivo salvo com sucesso!', 'ok');
    } catch (error) {
      console.error('Erro ao salvar arquivo:', error);
      this.showToast('Erro ao salvar arquivo', 'err');
    }
  }

  startWatching() {
    // Enviar comando para iniciar watch
    this.ws.send(JSON.stringify({
      type: 'watch',
      projectPath: './projects/current'
    }));
  }
}

// Inicializar quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
  window.app = new CapacitorIAStudio();
});