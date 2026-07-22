export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return res.status(500).json({ error: 'Server misconfigured: PINATA_JWT not set' });
  }

  try {
    const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(req.body),
    });

    const data = await pinataRes.json();
    res.status(pinataRes.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Metadata pin failed' });
  }
}
