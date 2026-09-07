# CapacitorIA Studio 🚀

**Build Native Mobile Apps with AI-Powered Development**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/yourusername/capacitoria-studio)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 📱 What is CapacitorIA Studio?

CapacitorIA Studio is a powerful IDE and development environment that combines **AI-assisted code generation** with **visual editing** to create native mobile applications using [Capacitor](https://capacitorjs.com/). Build Android and iOS apps without leaving your browser!

### ✨ Key Features

- **🤖 AI-Powered App Generation** - Describe your app in natural language and let AI generate complete Capacitor projects
- **🎨 Visual Editor** - Click, select, and edit HTML elements visually with real-time preview
- **📝 Code Editor** - Full-featured CodeMirror editor with syntax highlighting for HTML, CSS, and JavaScript
- **🔨 One-Click Build** - Generate APK, AAB, and IPA files directly from the interface
- **📦 Project Management** - Create, import, export, and switch between multiple projects
- **🔄 Live Preview** - See changes instantly in the built-in preview panel
- **🧠 AI Code Editing** - Select any component and use AI to modify its JavaScript or CSS
- **📊 Android 16 Support** - Full compatibility with API 36 (Android 16) and backward compatibility to Android 7 (API 24)
- **🎯 Component References** - Find where elements are used across your project files
- **🖼️ Asset Management** - Add images, icons, videos, and animations with drag & drop support
- **↩️ Undo/Redo** - Full undo/redo support (Ctrl+Z / Ctrl+Y) in the visual editor

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [npm](https://www.npmjs.com/) (v9 or later)
- [Android Studio](https://developer.android.com/studio) (for Android builds)
- [Xcode](https://developer.apple.com/xcode/) (for iOS builds - macOS only)
- [Java JDK 17+](https://adoptium.net/) (for Android builds)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/capacitoria-studio.git
cd capacitoria-studio

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your OpenAI API key

# Start the server
npm start