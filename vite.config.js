import fs from 'fs';
import { defineConfig } from 'vite';

// Array to store logs
const logs = [];

// Check if we're in development mode
const isDev = process.env.NODE_ENV !== 'production';

// Only try to read cert files in development mode
const httpsConfig = isDev ? {
  https: {
    key: fs.existsSync('./certs/key.pem') ? fs.readFileSync('./certs/key.pem') : undefined,
    cert: fs.existsSync('./certs/cert.pem') ? fs.readFileSync('./certs/cert.pem') : undefined,
  }
} : {};

export default defineConfig({
  root: 'src',
  base: './', // Use relative paths for GitHub Pages
  build: {
    outDir: '../dist'
  },
  server: {
    ...httpsConfig,
    // Add middleware to handle logs (only in development mode)
    middlewares: isDev ? [
      (req, res, next) => {
        if (req.url === '/api/log' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const logData = JSON.parse(body);
              const timestamp = new Date().toISOString();
              const formattedLog = `[${timestamp}] [${logData.level.toUpperCase()}] ${logData.message}`;
              
              // Store log in array (limited to last 100 entries)
              logs.push(formattedLog);
              if (logs.length > 100) logs.shift();
              
              // Print to server console with appropriate color
              const colors = {
                log: '\x1b[37m', // white
                error: '\x1b[31m', // red
                warn: '\x1b[33m'  // yellow
              };
              const color = colors[logData.level] || colors.log;
              console.log(`${color}${formattedLog}\x1b[0m`);
              
              res.statusCode = 200;
              res.end('OK');
            } catch (e) {
              console.error('Error processing log:', e);
              res.statusCode = 400;
              res.end('Bad Request');
            }
          });
        } else if (req.url === '/api/logs' && req.method === 'GET') {
          // Endpoint to get all logs
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify(logs));
        } else {
          next();
        }
      }
    ] : []
  }
});
