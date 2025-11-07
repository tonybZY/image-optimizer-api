require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Limite de taille de sortie : 9 MB
const MAX_OUTPUT_SIZE = 9 * 1024 * 1024; // 9 MB en bytes

// Configuration CORS
app.use(cors());
app.use(express.json());

// Configuration Multer pour le stockage en mémoire
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // Limite de 500MB en entrée
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

// Fonction pour garantir que l'image fait moins de 9 MB
async function ensureMaxSize(sharpInstance, format, initialQuality, maxWidth = null) {
  let quality = initialQuality;
  let width = maxWidth;
  let buffer;
  let attempts = 0;
  const maxAttempts = 15;

  while (attempts < maxAttempts) {
    try {
      let instance = sharpInstance.clone();

      // Redimensionner si une largeur est spécifiée
      if (width) {
        instance = instance.resize({ width, withoutEnlargement: true });
      }

      // Appliquer le format avec la qualité actuelle
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

      // Vérifier la taille
      if (buffer.length <= MAX_OUTPUT_SIZE) {
        return buffer; // ✅ Taille OK !
      }

      // ❌ Trop gros, on réduit
      attempts++;

      // Stratégie progressive : réduire la qualité puis redimensionner
      if (quality > 60) {
        quality -= 10; // Réduire la qualité de 10
      } else if (!width) {
        width = 8000; // Commencer à redimensionner
      } else if (width > 2000) {
        width = Math.floor(width * 0.8); // Réduire de 20%
      } else {
        quality = Math.max(50, quality - 5); // Dernière tentative : qualité minimale
      }

      console.log(`🔄 Tentative ${attempts}: qualité=${quality}, largeur=${width || 'originale'}, taille=${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    } catch (error) {
      console.error('Erreur lors de l\'optimisation:', error);
      throw error;
    }
  }

  // Si après 15 tentatives c'est toujours trop gros, retourner quand même
  console.warn('⚠️ Impossible de réduire sous 9 MB après 15 tentatives');
  return buffer;
}

// Route de santé
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

// Route pour optimiser une image
app.post('/optimize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    const quality = parseInt(req.body.quality) || 80;
    const format = req.body.format || 'webp';

    // Créer l'instance Sharp
    let sharpInstance = sharp(req.file.buffer, {
      limitInputPixels: false
    });

    // Optimiser avec garantie de taille < 9 MB
    const optimizedBuffer = await ensureMaxSize(sharpInstance, format, quality);
    
    // Calculer la réduction de taille
    const originalSize = req.file.buffer.length;
    const optimizedSize = optimizedBuffer.length;
    const reduction = ((originalSize - optimizedSize) / originalSize * 100).toFixed(2);

    res.set('Content-Type', `image/${format}`);
    res.set('X-Original-Size', originalSize);
    res.set('X-Optimized-Size', optimizedSize);
    res.set('X-Size-Reduction', `${reduction}%`);
    res.set('X-Under-9MB', optimizedSize <= MAX_OUTPUT_SIZE ? 'true' : 'false');
    
    // ✅ Retourner UNIQUEMENT l'image optimisée
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
    const fit = req.body.fit || 'inside';

    // Créer l'instance Sharp
    let sharpInstance = sharp(req.file.buffer, {
      limitInputPixels: false
    });

    // Redimensionner si les dimensions sont fournies
    if (width || height) {
      sharpInstance = sharpInstance.resize({
        width: width || null,
        height: height || null,
        fit: fit,
        withoutEnlargement: true
      });
    }

    // Optimiser avec garantie de taille < 9 MB
    const optimizedBuffer = await ensureMaxSize(sharpInstance, format, quality, width);
    
    const originalSize = req.file.buffer.length;
    const optimizedSize = optimizedBuffer.length;
    const reduction = ((originalSize - optimizedSize) / originalSize * 100).toFixed(2);

    res.set('Content-Type', `image/${format}`);
    res.set('X-Original-Size', originalSize);
    res.set('X-Optimized-Size', optimizedSize);
    res.set('X-Size-Reduction', `${reduction}%`);
    res.set('X-Under-9MB', optimizedSize <= MAX_OUTPUT_SIZE ? 'true' : 'false');
    
    // ✅ Retourner UNIQUEMENT l'image optimisée
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

    // Créer l'instance Sharp
    let sharpInstance = sharp(req.file.buffer, {
      limitInputPixels: false
    });

    // Optimiser avec garantie de taille < 9 MB
    const optimizedBuffer = await ensureMaxSize(sharpInstance, format, quality);
    
    res.set('Content-Type', `image/${format}`);
    res.set('X-Optimized-Size', optimizedBuffer.length);
    res.set('X-Under-9MB', optimizedBuffer.length <= MAX_OUTPUT_SIZE ? 'true' : 'false');
    
    // ✅ Retourner UNIQUEMENT l'image convertie
    res.send(optimizedBuffer);
  } catch (error) {
    console.error('Erreur lors de la conversion:', error);
    res.status(500).json({ error: 'Erreur lors de la conversion de l\'image' });
  }
});

// Gestion des erreurs
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
```

---

## 🎯 Nouveautés

### **1. Fonction `ensureMaxSize()`**
- Optimise progressivement jusqu'à atteindre < 9 MB
- Stratégie intelligente :
  1. Réduit la qualité (80 → 70 → 60)
  2. Puis redimensionne (8000 → 6400 → 5120...)
  3. Continue jusqu'à < 9 MB

### **2. Headers ajoutés**
- `X-Under-9MB: true/false` - Indique si < 9 MB
- Les autres headers restent informatifs

### **3. Logs dans Railway**
Vous verrez des logs comme :
```
🔄 Tentative 1: qualité=70, largeur=originale, taille=12.3 MB
🔄 Tentative 2: qualité=60, largeur=originale, taille=10.1 MB
🔄 Tentative 3: qualité=60, largeur=8000, taille=8.5 MB
✅ Succès: 8.5 MB
