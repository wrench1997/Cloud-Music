import '@/styles/globals.css'
import '@/styles/settings.css'
import Head from 'next/head'
import { AppUpdatesProvider } from '@/components/AppUpdates'

export default function App({ Component, pageProps }) {
  return <AppUpdatesProvider><Head><title>云感音乐</title><link rel="icon" href="./icon.ico" /><link rel="apple-touch-icon" href="./icon.png" /></Head><Component {...pageProps} /></AppUpdatesProvider>
}
