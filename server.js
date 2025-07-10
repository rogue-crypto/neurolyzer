require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: ['https://neurolyzer.onrender.com', 'http://localhost:3000', 'http://localhost:3050'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${cleanName}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 10
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
    }
  }
});

function initializeGeminiAPI() {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    console.error('GEMINI_API_KEY environment variable is not set');
    throw new Error('Missing Gemini API key');
  }
  return new GoogleGenerativeAI(API_KEY);
}

async function analyzeImageWithGemini(imagePath) {
  try {
    const genAI = initializeGeminiAPI();
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        temperature: 0.3,
        topK: 1,
        topP: 1,
        maxOutputTokens: 4096,
      }
    });
    
    if (!fs.existsSync(imagePath)) {
      throw new Error('Image file not found');
    }
    
    const imageData = fs.readFileSync(imagePath);
    const extension = path.extname(imagePath).substring(1).toLowerCase();
    let mimeType;
    
    switch(extension) {
      case 'jpg':
      case 'jpeg':
        mimeType = 'image/jpeg';
        break;
      case 'png':
        mimeType = 'image/png';
        break;
      case 'gif':
        mimeType = 'image/gif';
        break;
      case 'webp':
        mimeType = 'image/webp';
        break;
      default:
        mimeType = 'image/jpeg';
    }
    
    const prompt = `You are an expert dermatology AI assistant. Analyze this skin image and provide a comprehensive assessment.

Return ONLY a valid JSON object with this exact structure:
{
  "skin_type": "normal|dry|oily|combination|sensitive",
  "overall_condition": "Brief description of overall skin health",
  "detected_conditions": [
    {
      "condition_name": "Name of detected condition",
      "confidence": 0.85,
      "description": "Brief description of the condition",
      "severity": "mild|moderate|severe"
    }
  ],
  "recommended_products": [
    {
      "category": "cleanser|moisturizer|treatment|sunscreen",
      "recommendation": "Specific product type or brand recommendation",
      "ingredients_to_look_for": ["ingredient1", "ingredient2"]
    }
  ],
  "personalized_advice": "Detailed skincare advice based on analysis"
}

Rules:
- Return ONLY valid JSON
- No markdown formatting
- No explanations before or after JSON
- Use realistic confidence scores (0.0-1.0)
- Be specific but professional
- Include 2-4 product recommendations
- Provide actionable advice`;
    
    const imageParts = [
      {
        inlineData: {
          data: imageData.toString('base64'),
          mimeType: mimeType
        }
      }
    ];

    console.log(`Analyzing image: ${path.basename(imagePath)} (${mimeType})`);
    
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    let text = response.text();
    
    text = text.trim();
    
    if (text.includes('```json')) {
      text = text.split('```json')[1].split('```')[0].trim();
    } else if (text.includes('```')) {
      text = text.split('```')[1].split('```')[0].trim();
    }
    
    try {
      const jsonObj = JSON.parse(text);
      
      if (!jsonObj.skin_type || !jsonObj.overall_condition) {
        throw new Error('Invalid JSON structure');
      }
      
      return jsonObj;
    } catch (jsonError) {
      console.error("Failed to parse JSON response:", jsonError);
      console.error("Raw response:", text);
      
      return {
        error: "Analysis completed but returned invalid format",
        skin_type: "unknown",
        overall_condition: "Unable to determine from image",
        detected_conditions: [],
        recommended_products: [
          {
            "category": "cleanser",
            "recommendation": "Gentle, pH-balanced cleanser",
            "ingredients_to_look_for": ["ceramides", "hyaluronic acid"]
          }
        ],
        personalized_advice: "Please upload a clearer image for better analysis."
      };
    }
  } catch (error) {
    console.error("Error analyzing image with Gemini:", error);
    throw new Error(`Analysis failed: ${error.message}`);
  }
}

app.post('/api/analyze', upload.array('images', 5), async (req, res) => {
  console.log('POST /api/analyze - Request received');
  
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'No images uploaded. Please select at least one image.',
      code: 'NO_FILES'
    });
  }

  try {
    console.log(`Processing ${req.files.length} image(s)`);
    
    const analysisPromises = req.files.map(async (file, index) => {
      try {
        console.log(`Analyzing file ${index + 1}/${req.files.length}: ${file.originalname}`);
        const analysis = await analyzeImageWithGemini(file.path);
        
        setTimeout(() => {
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          } catch (cleanupError) {
            console.error('Error cleaning up file:', cleanupError);
          }
        }, 5000);
        
        return {
          filename: file.originalname,
          file_id: path.basename(file.path),
          timestamp: new Date().toISOString(),
          analysis: analysis,
          success: true
        };
      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        return {
          filename: file.originalname,
          file_id: path.basename(file.path),
          timestamp: new Date().toISOString(),
          error: fileError.message,
          success: false
        };
      }
    });
    
    const results = await Promise.all(analysisPromises);
    const successCount = results.filter(r => r.success).length;
    
    res.json({ 
      success: true,
      timestamp: new Date().toISOString(),
      total_files: results.length,
      successful_analyses: successCount,
      results: results
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to analyze images',
      code: 'ANALYSIS_ERROR'
    });
  }
});

app.get('/api/health', (req, res) => {
  const hasApiKey = !!process.env.GEMINI_API_KEY;
  res.json({
    status: 'healthy',
    service: 'neurolyzer-skin-analyzer',
    version: '2.1.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    api_key_configured: hasApiKey,
    uptime: process.uptime()
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    message: 'Neurolyzer Skin Analyzer API is operational',
    endpoints: {
      analyze: '/api/analyze (POST)',
      health: '/api/health (GET)',
      status: '/api/status (GET)'
    }
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Neurolyzer Skin Analyzer API',
    version: '2.1.0',
    documentation: 'https://neurolyzer.onrender.com/api/status'
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 15MB per file.',
        code: 'FILE_TOO_LARGE'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files. Maximum is 5 files per request.',
        code: 'TOO_MANY_FILES'
      });
    }
  }
  
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    code: 'SERVER_ERROR'
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    code: 'NOT_FOUND'
  });
});

const PORT = process.env.PORT || 3050;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===========================================`);
  console.log(`🧠 Neurolyzer Skin Analyzer API`);
  console.log(`===========================================`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 API URL: https://neurolyzer.onrender.com`);
  console.log(`📊 Health check: https://neurolyzer.onrender.com/api/health`);
  console.log(`🔍 Analyze endpoint: https://neurolyzer.onrender.com/api/analyze`);
  console.log(`📋 Status: https://neurolyzer.onrender.com/api/status`);
  console.log(`===========================================`);
  
  if (!process.env.GEMINI_API_KEY) {
    console.error('⚠️  WARNING: GEMINI_API_KEY not found in environment variables');
  } else {
    console.log('✅ Gemini API key configured');
  }
});
