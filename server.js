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

async function fastOptimize(sharpInstance, format, quality, maxWidth = null) {
  const startTime = Date.now();
  
  const metadata = await sharpInstance.metadata();
  const originalPixels = metadata.width * metadata.height;
  
  let targetWidth = maxWidth || metadata.width;
  
  if (originalPixels > 100000000) {
    targetWidth = Math.min(targetWidth, 10000);
  } else if (originalPixels > 50000000) {
    targetWidth = Math.min(targetWidth, 12000);
  } else if (originalPixels > 20000000) {
    targetWidth = Math.min(targetWidth, 15000);
  }
  
  let instance = sharpInstance.clone();
  
  if (targetWidth < metadata.width) {
    instance = instance.resize({
      width: targetWidth,
      withoutEnlargement: true,
      kernel: 'cubic',
      fastShrinkOnLoad: true
    });
  }
  
  instance = instance
    .withMetadata(false)
    .rotate();
  
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg':
      instance = instance.jpeg({
        quality,
        progressive: true,
        optimizeCoding: true,
        mozjpeg: true,
        chromaSubsampling: '4:2:0'
      });
      break;
    case 'png':
      instance = instance.png({
        quality,
        compressionLevel: 6,
        palette: true,
        effort: 4
      });
      break;
    case 'webp':
      instance = instance.webp({
        quality,
        effort: 4,
        smartSubsample: true
      });
      break;
    case 'avif':
      instance = instance.avif({
        quality,
        effort: 4
      });
      break;
  }
  
  let buffer = await instance.toBuffer();
  
  if (buffer.length <= MAX_OUTPUT_SIZE) {
    const elapsed = Date.now() - startTime;
    console.log(`✅ Optimisé en ${(elapsed / 1000).toFixed(2)}s - Taille: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    return buffer;
  }
  
  console.log(`⚠️ Première tentative trop grosse (${(buffer.length / 1024 / 1024).toFixed(2)} MB), réduction...`);
  
  const reductionRatio = Math.sqrt(MAX_OUTPUT_SIZE / buffer.length) * 0.95;
  targetWidth = Math.floor(targetWidth * reductionRatio);
  quality = Math.max(60, Math.floor(quality * 0.85));
  
  instance = sharpInstance.clone()
    .resize({
      width: targetWidth,
      withoutEnlargement: true,
      kernel: 'cubic',
      fastShrinkOnLoad: true
    })
    .withMetadata(false)
    .rotate();
  
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg':
      instance = instance.jpeg({
        quality,
        progressive: true,
        optimizeCoding: true,
        mozjpeg: true,
        chromaSubsampling: '4:2:0'
      });
      break;
    case 'png':
      instance = instance.png({
        quality,
        compressionLevel: 6,
        palette: true,
        effort: 4
      });
      break;
    case 'webp':
      instance = instance.webp({
        quality,
        effort: 4,
        smartSubsample: true
      });
      break;
    case 'avif':
      instance = instance.avif({
        quality,
        effort: 4
      });
      break;
  }
  
  buffer = await instance.toBuffer();
  
  const elapsed = Date.now() - startTime;
  console.log(`✅ Optimisé en ${(elapsed / 1000).toFixed(2)}s - Taille finale: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
  
  return buffer;
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'API d\'optimisation d\'images est active (MODE RAPIDE)',
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
    const format = req.body.format || 'jpeg';

    let sharpInstance = sharp(req.file.buffer, {
      limitInputPixels: false,
      sequentialRead: true
    });

    const optimizedBuffer = await fastOptimize(sharpInstance, format, quality);
    
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
    const format = req.body.format || 'jpeg';

    let sharpInstance = sharp(req.file.buffer, {
      limitInputPixels: false,
      sequentialRead: true
    });

    const optimizedBuffer = await fastOptimize(sharpInstance, format, quality, width || height);
    
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

    const format = req.body.format || 'jpeg';
    const quality = parseInt(req.body.quality) || 80;

    let sharpInstance = sharp(req.file.buffer, {
      limitInputPixels: false,
      sequentialRead: true
    });

    const optimizedBuffer = await fastOptimize(sharpInstance, format, quality);
    
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
  console.log(`🚀 Serveur démarré sur le port ${PORT} (MODE RAPIDE)`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`✅ Taille maximale de sortie: 9 MB`);
});
