export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return res.status(500).json({
      error: 'KEY NO ENCONTRADA',
      vars: Object.keys(process.env).filter(k => k.includes('OPENAI'))
    })
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Error OpenAI' })
    }

    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: 'Error interno: ' + err.message })
  }
}
