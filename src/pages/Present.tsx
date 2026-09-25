import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'

export default function Present() {
  const { code: rawCode = '' } = useParams()
  const code = rawCode.toUpperCase()
  const joinUrl = `${window.location.origin}/r/${code}`
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(joinUrl, { width: 720, margin: 1, color: { dark: '#102844', light: '#ffffff' } })
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setQr(null)
      })
    return () => {
      cancelled = true
    }
  }, [joinUrl])

  return (
    <main className="projector">
      <h1>Join at {window.location.host}/r</h1>
      <div className="projector-code" aria-label={`Room code ${code.split('').join(' ')}`}>
        {code}
      </div>
      {qr && <img className="projector-qr" src={qr} alt={`QR code for ${joinUrl}`} />}
      <p className="projector-url">{joinUrl}</p>
      {/* TODO: live top questions and open poll results */}
    </main>
  )
}
