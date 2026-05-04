import express from 'express';
import dotenv from 'dotenv';
import { supabase } from './config/supabase.js';

dotenv.config();

const app = express();

// Basic middleware
app.use(express.json());

// Simple test routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Tatva Direct API Server is running!',
    port: process.env.PORT,
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    supabase: process.env.SUPABASE_URL ? 'Configured' : 'Not configured'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    port: process.env.PORT
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'Tatva Direct API',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    port: process.env.PORT
  });
});

// Catch all other routes
app.all('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

const port = process.env.PORT || 5000;
const HOST = '0.0.0.0';

console.log(`🚀 Starting simple test server...`);
console.log(`📍 Host: ${HOST}`);
console.log(`🔌 Port: ${port}`);
console.log(`🌍 Environment: ${process.env.NODE_ENV}`);

const server = app.listen(port, HOST, () => {
  console.log(`✅ Simple test server running on http://${HOST}:${port}`);
  console.log(`🏥 Health check: http://${HOST}:${port}/health`);
  console.log(`🌐 Server is ready and listening for connections`);
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use`);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});