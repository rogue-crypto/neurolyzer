// Enhanced AI Skin Analyzer using Gemini API with JSON Response Format
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use(cors());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync('uploads/')) {
      fs.mkdirSync('uploads/');
    }
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload an image.'), false);
    }
  }
});

// Initialize Gemini API
function initializeGeminiAPI() {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    console.error('GEMINI_API_KEY environment variable is not set');
    throw new Error('Missing API key');
  }
  return new GoogleGenerativeAI(API_KEY);
}

// Function to analyze image with Gemini
async function analyzeImageWithGemini(imagePath) {
  try {
    const genAI = initializeGeminiAPI();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    // Read the image file and determine the mime type
    const imageData = fs.readFileSync(imagePath);
    const extension = path.extname(imagePath).substring(1).toLowerCase();
    const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
    
    // Structured prompt for JSON response
    const prompt = `You are a dermatology assistant AI. Analyze this skin image and provide a detailed assessment.

Format your response as a valid JSON object with the following structure:
{
  "skin_type": "string (dry, oily, combination, normal, sensitive) Skin Type",
  "overall_condition": "string (description of skin health)",
  "detected_conditions": [
    {
      "condition_name": "string (name of condition)",
      "confidence": number (percentage as decimal, e.g., 0.85 for 85%),
      "description": "string (brief description)",
      "severity": "string (mild, moderate, severe)"
    }
  ],
  "recommended_products": [
    {
      "category": "string (e.g., cleanser, moisturizer) give recommended company name or product name",
      "recommendation": "string (product type recommendation)",
      "ingredients_to_look_for": ["string"]
    }
  ],
  "personalized_advice": "string (care tips based on analysis)"
}

IMPORTANT: Return ONLY valid JSON with no explanations, warnings, or additional text before or after. Do not use markdown formatting.`;
    
    // Prepare image parts for Gemini API
    const imageParts = [
      {
        inlineData: {
          data: imageData.toString('base64'),
          mimeType: mimeType
        }
      }
    ];

    console.log(`Analyzing image: ${path.basename(imagePath)}`);
    
    // Generate content
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    let text = response.text();
    
    // Ensure we have valid JSON
    try {
      // Clean up any markdown formatting or extra text that might be in the response
      if (text.includes('```json')) {
        text = text.split('```json')[1].split('```')[0].trim();
      }
      
      // Parse to validate and then stringify for clean formatting
      const jsonObj = JSON.parse(text);
      return JSON.stringify(jsonObj);
    } catch (jsonError) {
      console.error("Failed to parse JSON response:", jsonError);
      return JSON.stringify({
        error: "Analysis completed but returned invalid format",
        raw_text: text
      });
    }
  } catch (error) {
    console.error("Error analyzing image with Gemini:", error);
    throw error;
  }
}

// API endpoints
app.post('/api/analyze', upload.array('images', 5), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'No images uploaded' 
    });
  }

  try {
    console.log(`Processing ${req.files.length} image(s)`);
    
    const analysisPromises = req.files.map(async (file) => {
      const analysis = await analyzeImageWithGemini(file.path);
      
      // Parse the JSON string to ensure it's valid
      let parsedAnalysis;
      try {
        parsedAnalysis = JSON.parse(analysis);
      } catch (e) {
        parsedAnalysis = { error: "Failed to parse analysis result" };
      }
      
      return {
        filename: file.originalname,
        file_id: path.basename(file.path),
        timestamp: new Date().toISOString(),
        analysis: parsedAnalysis
      };
    });
    
    const results = await Promise.all(analysisPromises);
    
    res.json({ 
      success: true,
      timestamp: new Date().toISOString(),
      count: results.length,
      results: results
    });
    
    // Clean up uploads after processing (optional)
    // req.files.forEach(file => fs.unlinkSync(file.path));
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to analyze images'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ai-skin-analyzer',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// Start server
const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
  console.log(`===========================================`);
  console.log(`🔍 AI Skin Analyzer running on port ${PORT}`);
  console.log(`===========================================`);
  console.log(`→ API endpoint: http://localhost:${PORT}/api/analyze`);
  console.log(`→ Health check: http://localhost:${PORT}/api/health`);
  console.log(`→ Make sure GEMINI_API_KEY is set in .env file`);
});