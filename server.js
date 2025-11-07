require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration CORS
app.use(cors());
app.use(express.json());

// Configuration Multer pour le stockage en mémoire
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // Limite de 500MB
  },
  fileFilter: (req, file, cb) => {
    // Vérifier le type de fichier
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Le fichier doit être une image'), false);
    }
  }
});

// Route de santé
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'API d\'optimisation d\'images est active',
    endpoints: {
      optimize: 'POST /optimize - Optimiser une image',
      resize: 'POST /resize - Redimensionner et optimiser une image',
      convert: 'POST /convert - Convertir le format d\'une image'
    }
  });
});

// Route pour optimiser une image
app.post('/optimize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const quality = parseInt(req.body.quality) || 80;
    const format = req.body.format || 'webp';

    // Optimiser l'image
    let sharpInstance = sharp(req.file.buffer);
    
    // Convertir et compresser selon le format
    switch (format.toLowerCase()) {
      case 'jpeg':
      case 'jpg':
        sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true });
        break;
      case 'png':
        sharpInstance = sharpInstance.png({ 
          quality, 
          compressionLevel: 9,
          adaptiveFiltering: true
        });
        break;
      case 'webp':
        sharpInstance = sharpInstance.webp({ quality });
        break;
      case 'avif':
        sharpInstance = sharpInstance.avif({ quality });
        break;
      default:
        sharpInstance = sharpInstance.webp({ quality });
    }

    const optimizedBuffer = await sharpInstance.toBuffer();
    
    // Calculer la réduction de taille
    const originalSize = req.file.buffer.length;
    const optimizedSize = optimizedBuffer.length;
    const reduction = ((originalSize - optimizedSize) / originalSize * 100).toFixed(2);

    res.set('Content-Type', `image/${format}`);
    res.set('X-Original-Size', originalSize);
    res.set('X-Optimized-Size', optimizedSize);
    res.set('X-Size-Reduction', `${reduction}%`);
    
    res.send(optimizedBuffer);
  } catch (error) {
    console.error('Erreur lors de l\'optimisation:', error);
    res.status(500).json({ error: 'Erreur lors de l\'optimisation de l\'image' });
  }
});

// Route pour redimensionner et optimiser une image
app.post('/resize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const width = parseInt(req.body.width);
    const height = parseInt(req.body.height);
    const quality = parseInt(req.body.quality) || 80;
    const format = req.body.format || 'webp';
    const fit = req.body.fit || 'cover'; // cover, contain, fill, inside, outside

    let sharpInstance = sharp(req.file.buffer);

    // Redimensionner si les dimensions sont fournies
    if (width || height) {
      sharpInstance = sharpInstance.resize({
        width: width || null,
        height: height || null,
        fit: fit,
        withoutEnlargement: true
      });
    }

    // Appliquer le format et la compression
    switch (format.toLowerCase()) {
      case 'jpeg':
      case 'jpg':
        sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true });
        break;
      case 'png':
        sharpInstance = sharpInstance.png({ quality, compressionLevel: 9 });
        break;
      case 'webp':
        sharpInstance = sharpInstance.webp({ quality });
        break;
      case 'avif':
        sharpInstance = sharpInstance.avif({ quality });
        break;
      default:
        sharpInstance = sharpInstance.webp({ quality });
    }

    const optimizedBuffer = await sharpInstance.toBuffer();
    
    const originalSize = req.file.buffer.length;
    const optimizedSize = optimizedBuffer.length;
    const reduction = ((originalSize - optimizedSize) / originalSize * 100).toFixed(2);

    res.set('Content-Type', `image/${format}`);
    res.set('X-Original-Size', originalSize);
    res.set('X-Optimized-Size', optimizedSize);
    res.set('X-Size-Reduction', `${reduction}%`);
    
    res.send(optimizedBuffer);
  } catch (error) {
    console.error('Erreur lors du redimensionnement:', error);
    res.status(500).json({ error: 'Erreur lors du redimensionnement de l\'image' });
  }
});

// Route pour convertir le format d'une image
app.post('/convert', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const format = req.body.format || 'webp';
    const quality = parseInt(req.body.quality) || 80;

    let sharpInstance = sharp(req.file.buffer);

    switch (format.toLowerCase()) {
      case 'jpeg':
      case 'jpg':
        sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true });
        break;
      case 'png':
        sharpInstance = sharpInstance.png({ quality, compressionLevel: 9 });
        break;
      case 'webp':
        sharpInstance = sharpInstance.webp({ quality });
        break;
      case 'avif':
        sharpInstance = sharpInstance.avif({ quality });
        break;
      default:
        return res.status(400).json({ error: 'Format non supporté' });
    }

    const convertedBuffer = await sharpInstance.toBuffer();
    
    res.set('Content-Type', `image/${format}`);
    res.send(convertedBuffer);
  } catch (error) {
    console.error('Erreur lors de la conversion:', error);
    res.status(500).json({ error: 'Erreur lors de la conversion de l\'image' });
  }
});

// Gestion des erreurs
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Le fichier est trop volumineux (max 10MB)' });
    }
  }
  res.status(500).json({ error: error.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
});
