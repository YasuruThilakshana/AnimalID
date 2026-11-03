import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import MagicString from 'magic-string'
import { parseAst } from 'rolldown/parseAst'
import { defineConfig } from 'vite'

const STRIPPED_METHODS = new Set(['log', 'debug', 'info'])

function isStrippedLogCall(node) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  return (
    callee &&
    callee.type === 'MemberExpression' &&
    callee.object &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'console' &&
    callee.property &&
    callee.property.type === 'Identifier' &&
    STRIPPED_METHODS.has(callee.property.name)
  )
}

// Production-only console strip (build hook): removes bare
// console.log/debug/info(...) statements and `debugger` via the real AST,
// keeping console.error/warn for production diagnostics. Conservative by
// design — nested/valued uses are left for the minifier, and any module
// that fails to parse is passed through untouched.
function stripProdLogs() {
  return {
    name: 'animalid-strip-prod-logs',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (id.includes('node_modules')) return null
      if (!/\.[mc]?[jt]sx?$/.test(file)) return null
      if (!/\b(console\.(log|debug|info)|debugger)\b/.test(code)) return null
      const lang = /\.tsx?$/.test(file) ? 'tsx' : /\.jsx$/.test(file) ? 'jsx' : 'js'
      let program
      try {
        program = parseAst(code, { lang }, file)
      } catch {
        return null
      }
      const out = new MagicString(code)
      let changed = false
      const visit = (node) => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) {
          node.forEach(visit)
          return
        }
        if (node.type === 'DebuggerStatement') {
          out.remove(node.start, node.end)
          changed = true
          return
        }
        if (node.type === 'ExpressionStatement' && isStrippedLogCall(node.expression)) {
          out.remove(node.start, node.end)
          changed = true
          return
        }
        for (const key of Object.keys(node)) {
          if (key === 'parent') continue
          visit(node[key])
        }
      }
      visit(program)
      if (!changed) return null
      return { code: out.toString(), map: out.generateMap({ hires: true }) }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [stripProdLogs(), react(), tailwindcss()],
  build: {
    // Never ship source maps: internal logic must not be inspectable in prod.
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        timeout: 120000,
        proxyTimeout: 120000,
        configure: (proxy, _options) => {
          // eslint-disable-next-line no-unused-vars -- pinned proxy signature: keep (err, req, res) verbatim.
          proxy.on('error', (err, req, res) => {
            console.error('Vite Proxy Error:', err);
          });
        }
      },
      '/uploads': 'http://localhost:5000',
    },
  },
})
