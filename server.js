require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_OUTPUT_SIZE = 9 * 1024 * 1024;

app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Le fichier doit être une image'), false);
    }
  }
});

async function ensureMaxSize(sharpInstance, format, initialQuality, maxWidth = null) {
  let quality = initialQuality;
  let width = maxWidth;
  let buffer;
  let attempts = 0;
  const maxAttempts = 15;

  while (attempts < maxAttempts) {
    try {
      let instance = sharpInstance.clone();

      if (width) {
        instance = instance.resize({ width, withoutEnlargement: true });
      }

      switch (format.toLowerCase()) {
        case 'jpeg':
        case 'jpg':
          instance = instance.jpeg({ quality, mozjpeg: true });
          break;
        case 'png':
          instance = instance.png({ quality, compressionLevel: 9 });
          break;
        case 'webp':
          instance = instance.webp({ quality });
          break;
        case 'avif':
          instance = instance.avif({ quality });
          break;
      }

      buffer = await instance.toBuffer();

      if (buffer.length <= MAX_OUTPUT_SIZE) {
        return buffer;
      }

      attempts++;

      if (quality > 60) {
        quality -= 10;
      } else if (!width) {
        width = 8000;
      } else if (width > 2000) {
        width = Math.floor(width * 0.8);
      } else {
        quality = Math.max(50, quality - 5);
      }

      console.log(`Tentative ${attempts}: qualité=${quality}, largeur=${width || 'originale'}, taille=${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    } catch (error) {
      console.error('Erreur lors de l\'optimisation:', error);
      throw error;
    }
  }

  console.warn('Impossible de réduire sous 9 MB après 15 tentatives');
  return buffer;
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'API d\'optimisation d\'images est active',
    maxOutputSize: '9 MB',
    endpoints: {
      optimize: 'POST /optimize - Optimiser une image (max 9 MB en sortie)',
      resize: 'POST /resize - Redimensionner et optimiser une image (max 9 MB en sortie)',
      convert: 'POST /convert - Convertir le format d\'une image (max 9 MB en sortie)'
    }
  });
});

app.post('/optimize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const quality = parseInt(req.body.quality) || 80;
    const format = req.body.format || 'webp';

    let sharpInstance = sharp(req.file.buffer, {
      limitInputPixels: false
    });

    const optimizedBuffer = await ensureMaxSize(sharpInstance, format, quality);
    
    const originalSize = req.file.buffer.length;
    const optimizedSize = optimizedBuffer.length;
    const reduction = ((originalSize - optimizedSize) / originalSize * 100).toFixed(2);

    res.set('Content-Type', `image/${format}`);
    res.set('X-Original-Size', originalSize);
    res.set('X-Optimized-Size', optimizedSize);
    res.set('X-Size-Reduction', `${reduction}%`);
    res.set('X-Under-9MB', optimizedSize <= MAX_OUTPUT_SIZE ? 'true' : 'false');
    
    res.send(optimizedBuffer);
  } catch (error) {
    console.error('Erreur lors de l\'optimisation:', error);
    res.status(500).json({ error: 'Erreur lors de l\'optimisation de l\'image' });
  }
});

app.post('/resize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const width = parseInt(req.body.width);
    const height = parseInt(req.body.height);
    const quality = parseInt(req.body.quality) || 80;
    const format = req.body.format || 'webp';
    const fit = req.body.fit || 'inside';

    let sharpInstance = sharp(req.file.buffer, {
      limitInputPixels: false
    });

    if (width || height) {
      sharpInstance = sharpInstance.resize({
        width: width || null,
        height: height || null,
        fit: fit,
        withoutEnlargement: true
      });
    }

    const optimizedBuffer = await ensureMaxSize(sharpInstance, format, quality, width);
    
    const originalSize = req.file.buffer.length;
    const optimizedSize = optimizedBuffer.length;
    const reduction = ((originalSize - optimizedSize) / originalSize * 100).toFixed(2);

    res.set('Content-Type', `image/${format}`);
    res.set('X-Original-Size', originalSize);
    res.set('X-Optimized-Size', optimizedSize);
    res.set('X-Size-Reduction', `${reduction}%`);
    res.set('X-Under-9MB', optimizedSize <= MAX_OUTPUT_SIZE ? 'true' : 'false');
    
    res.send(optimizedBuffer);
  } catch (error) {
    console.error('Erreur lors du redimensionnement:', error);
    res.status(500).json({ error: 'Erreur lors du redimensionnement de l\'image' });
  }
});

app.post('/convert', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const format = req.body.format || 'webp';
    const quality = parseInt(req.body.quality) || 80;

    let sharpInstance = sharp(req.file.buffer, {
      limitInputPixels: false
    });

    const optimizedBuffer = await ensureMaxSize(sharpInstance, format, quality);
    
    res.set('Content-Type', `image/${format}`);
    res.set('X-Optimized-Size', optimizedBuffer.length);
    res.set('X-Under-9MB', optimizedBuffer.length <= MAX_OUTPUT_SIZE ? 'true' : 'false');
    
    res.send(optimizedBuffer);
  } catch (error) {
    console.error('Erreur lors de la conversion:', error);
    res.status(500).json({ error: 'Erreur lors de la conversion de l\'image' });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Le fichier est trop volumineux (max 500MB)' });
    }
  }
  res.status(500).json({ error: error.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`✅ Taille maximale de sortie: 9 MB`);
});
