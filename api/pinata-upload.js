export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return res.status(500).json({ error: 'Server misconfigured: PINATA_JWT not set' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': req.headers['content-type'],
      },
      body,
    });

    const data = await pinataRes.json();
    res.status(pinataRes.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
}
