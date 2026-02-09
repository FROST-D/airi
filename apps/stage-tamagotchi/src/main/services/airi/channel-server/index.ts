import { X509Certificate } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { env, platform } from 'node:process'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain } from 'electron'
import { createCA, createCert } from 'mkcert'
import { x } from 'tinyexec'

import { electronRestartWebSocketServer, electronStartWebSocketServer } from '../../../../shared/eventa'
import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

let serverInstance: { close: (closeActiveConnections?: boolean) => Promise<void> } | null = null
let serverIsStarting: Promise<void> | null = null
let serverIsRunning = false

function getLocalIPs(): string[] {
  const interfaces = networkInterfaces()
  const addresses: string[] = []

  const VIRTUAL_INTERFACE_PREFIXES = [
    'vboxnet',
    'vmnet',
    'docker',
    'br-',
    'veth',
    'utun',
    'wg',
    'tap',
    'tun',
  ]
  const isVirtualInterface = (name: string) =>
    VIRTUAL_INTERFACE_PREFIXES.some(prefix => name.startsWith(prefix))

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries)
      continue
    if (isVirtualInterface(name))
      continue

    for (const entry of entries) {
      const rawAddress = entry.address
      if (!rawAddress)
        continue

      const address = rawAddress.includes('%') ? rawAddress.split('%')[0] : rawAddress
      if (isIP(address))
        addresses.push(address)
    }
  }

  return addresses
}

function getCertificateDomains(): string[] {
  const localIPs = getLocalIPs()
  const hostname = env.SERVER_RUNTIME_HOSTNAME
  return Array.from(new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    ...(hostname ? [hostname] : []),
    ...localIPs,
  ]))
}

function certHasAllDomains(certPem: string, domains: string[]): boolean {
  try {
    const cert = new X509Certificate(certPem)
    const san = cert.subjectAltName || ''
    const entries = san.split(',').map(part => part.trim())
    const values = entries
      .map((entry) => {
        if (entry.startsWith('DNS:'))
          return entry.slice(4).trim()
        if (entry.startsWith('IP Address:'))
          return entry.slice(11).trim()
        return ''
      })
      .filter(Boolean)

    const sanSet = new Set(values)
    return domains.every(domain => sanSet.has(domain))
  }
  catch {
    return false
  }
}

async function installCACertificate(caCert: string) {
  const log = useLogg('main/server-runtime/cert-install').useGlobalConfig()
  const userDataPath = app.getPath('userData')
  const caCertPath = join(userDataPath, 'websocket-ca-cert.pem')
  writeFileSync(caCertPath, caCert)

  try {
    if (platform === 'darwin') {
      log.log('Installing certificate to macOS keychain...')
      await x(`security`, ['add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', `"${caCertPath}"`], { nodeOptions: { stdio: 'ignore' } })
      log.log('Certificate installed to macOS keychain')
    }
    else if (platform === 'win32') {
      log.log('Installing certificate to Windows certificate store (may require UAC elevation)...')
      await x(`certutil`, ['-addstore', '-f', 'Root', `"${caCertPath}"`], { nodeOptions: { stdio: 'ignore' } })
      log.log('Certificate installed to Windows certificate store')
    }
    else if (platform === 'linux') {
      log.log('Installing certificate to Linux CA store...')
      const caDir = '/usr/local/share/ca-certificates'
      const caFileName = 'airi-websocket-ca.crt'
      try {
        writeFileSync(join(caDir, caFileName), caCert)
        await x('update-ca-certificates', [], { nodeOptions: { stdio: 'ignore' } })
        log.log('Certificate installed to system CA store')
      }
      catch {
        log.log('System CA store install failed, trying user CA store...')
        const userCaDir = join(env.HOME || '', '.local/share/ca-certificates')
        try {
          if (!existsSync(userCaDir)) {
            await x(`mkdir`, ['-p', `"${userCaDir}"`], { nodeOptions: { stdio: 'ignore' } })
          }
          writeFileSync(join(userCaDir, caFileName), caCert)
          log.log('Certificate installed to user CA store')
        }
        catch {
          log.log('Failed to install to user CA store')
          // Ignore errors
        }
      }
    }
  }
  catch (error) {
    log.withError(error).warn('Certificate installation failed (continuing anyway)')
    // Ignore installation errors
  }
}

async function generateCertificate() {
  const log = useLogg('main/server-runtime/cert').useGlobalConfig()
  const userDataPath = app.getPath('userData')
  const caCertPath = join(userDataPath, 'websocket-ca-cert.pem')
  const caKeyPath = join(userDataPath, 'websocket-ca-key.pem')

  let ca: { key: string, cert: string }

  if (existsSync(caCertPath) && existsSync(caKeyPath)) {
    log.log('Using existing CA certificate')
    ca = {
      cert: readFileSync(caCertPath, 'utf-8'),
      key: readFileSync(caKeyPath, 'utf-8'),
    }
  }
  else {
    log.log('Creating new CA certificate...')
    ca = await createCA({
      organization: 'AIRI',
      countryCode: 'US',
      state: 'Development',
      locality: 'Local',
      validity: 365,
    })
    log.log('CA certificate created, saving to disk...')
    writeFileSync(caCertPath, ca.cert)
    writeFileSync(caKeyPath, ca.key)

    log.log('Installing CA certificate to system trust store...')
    await installCACertificate(ca.cert)
    log.log('CA certificate installation completed')
  }

  const domains = getCertificateDomains()
  log.log('Generating server certificate for domains:', domains)

  const cert = await createCert({
    ca: { key: ca.key, cert: ca.cert },
    domains,
    validity: 365,
  })
  log.log('Server certificate generated successfully')

  return {
    cert: cert.cert,
    key: cert.key,
  }
}

async function getOrCreateCertificate() {
  const userDataPath = app.getPath('userData')
  const certPath = join(userDataPath, 'websocket-cert.pem')
  const keyPath = join(userDataPath, 'websocket-key.pem')
  const expectedDomains = getCertificateDomains()

  if (existsSync(certPath) && existsSync(keyPath)) {
    const cert = readFileSync(certPath, 'utf-8')
    const key = readFileSync(keyPath, 'utf-8')
    if (certHasAllDomains(cert, expectedDomains)) {
      return { cert, key }
    }
  }

  const { cert, key } = await generateCertificate()
  writeFileSync(certPath, cert)
  writeFileSync(keyPath, key)

  return { cert, key }
}

export async function setupServerChannel(options?: { websocketSecureEnabled?: boolean }) {
  const log = useLogg('main/server-runtime').useGlobalConfig()

  // If server is already running, skip
  if (serverIsRunning && serverInstance) {
    log.log('Server is already running, skipping setup')
    return
  }

  // If server is already starting, wait for that to complete
  if (serverIsStarting) {
    log.log('Server is already starting, waiting for it to complete')
    return serverIsStarting
  }

  log.log('Setting up server channel', { options })
  const secureEnabled = options?.websocketSecureEnabled ?? false

  serverIsStarting = (async () => {
    try {
      const serverRuntime = await import('@proj-airi/server-runtime')
      const { plugin: ws } = await import('crossws/server')
      const { serve } = await import('h3')

      const h3App = serverRuntime.setupApp()

      const port = env.PORT ? Number(env.PORT) : 6121
      const hostname = env.SERVER_RUNTIME_HOSTNAME || '0.0.0.0'

      // FIXME: should prompt user to grant permission to save certificate files on macOS
      const tls = secureEnabled ? await getOrCreateCertificate() : undefined

      const instance = serve(h3App.app, {
        // @ts-expect-error - the .crossws property wasn't extended in types
        plugins: [ws({ resolve: async req => (await h3App.app.fetch(req)).crossws })],
        port,
        hostname,
        tls,
        reusePort: true,
        silent: true,
        manual: true,
        gracefulShutdown: {
          forceTimeout: 0.5,
          gracefulTimeout: 0.5,
        },
      })

      serverInstance = {
        close: async (closeActiveConnections = false) => {
          log.log('closing all peers')
          h3App.closeAllPeers()
          log.log('closing server instance')
          await instance.close(closeActiveConnections)
          log.log('server instance closed')
          serverIsRunning = false
        },
      }

      const servePromise = instance.serve()
      if (servePromise instanceof Promise) {
        servePromise.catch((error) => {
          const nodejsError = error as NodeJS.ErrnoException
          if ('code' in nodejsError && nodejsError.code === 'EADDRINUSE') {
            log.withError(error).warn('Port already in use, assuming server is already running')
            serverIsRunning = true
            return
          }

          log.withError(error).error('Error serving WebSocket server')
          serverIsRunning = false
        })
      }

      serverIsRunning = true

      const protocol = secureEnabled ? 'wss' : 'ws'
      if (hostname === '0.0.0.0') {
        const ips = getLocalIPs().filter(ip => ip !== '127.0.0.1' && ip !== '::1')
        const targets = ips.length > 0 ? ips.join(', ') : 'localhost'
        log.log(`@proj-airi/server-runtime started on ${protocol}://0.0.0.0:${port} (reachable via: ${targets})`)
      }
      else {
        log.log(`@proj-airi/server-runtime started on ${protocol}://${hostname}:${port}`)
      }

      onAppBeforeQuit(async () => {
        if (serverInstance && typeof serverInstance.close === 'function') {
          try {
            await serverInstance.close()
            log.log('WebSocket server closed')
          }
          catch (error) {
            const nodejsError = error as NodeJS.ErrnoException
            if ('code' in nodejsError && nodejsError.code === 'ERR_SERVER_NOT_RUNNING') {
              return
            }

            log.withError(error).error('Error closing WebSocket server')
          }
        }
      })
    }
    catch (error) {
      log.withError(error).error('failed to start WebSocket server')
      serverIsRunning = false
    }
    finally {
      serverIsStarting = null
    }
  })()

  return serverIsStarting
}

export async function restartServerChannel(options?: { websocketSecureEnabled?: boolean }) {
  const log = useLogg('main/server-runtime').useGlobalConfig()
  log.log('restarting server channel', { options })

  if (serverInstance && typeof serverInstance.close === 'function') {
    try {
      log.log('closing existing server instance')
      await serverInstance.close(true)
      log.log('existing server instance closed')
    }
    catch {
      // Ignore errors when closing
    }
  }

  serverInstance = null
  serverIsRunning = false
  serverIsStarting = null
  await setupServerChannel(options)
}

export function setupServerChannelHandlers() {
  const log = useLogg('main/server-runtime').useGlobalConfig()
  const { context } = createContext(ipcMain)
  log.log('setupServerChannelHandlers', { context })

  defineInvokeHandler(context, electronStartWebSocketServer, async (req) => {
    const log = useLogg('main/server-runtime').useGlobalConfig()
    log.log('Received request to start WebSocket server', { websocketSecureEnabled: req?.websocketSecureEnabled })

    try {
      await setupServerChannel({ websocketSecureEnabled: req?.websocketSecureEnabled })
      log.log('WebSocket server setup completed successfully')
      return { success: true }
    }
    catch (error) {
      log.withError(error).error('Failed to setup WebSocket server')
      return { success: false, error: String(error) }
    }
  })

  defineInvokeHandler(context, electronRestartWebSocketServer, async (req) => {
    console.debug('defineInvokeHandler - Received request to restart WebSocket server restartServerChannel', { req })
    await restartServerChannel({ websocketSecureEnabled: req?.websocketSecureEnabled })
  })
}
