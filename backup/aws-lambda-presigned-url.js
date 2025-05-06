// AWS Lambda function for generating S3 pre-signed URLs
// File: generate-upload-url.js

const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

// Initialize the S3 client
const s3 = new AWS.S3();

// Configure the bucket name from environment variables
const BUCKET_NAME = process.env.S3_BUCKET_NAME; // e.g., 'aspengrove-client-uploads'

/**
 * Lambda handler function
 * @param {Object} event - API Gateway event
 * @param {Object} context - Lambda context
 * @returns {Object} - API Gateway response
 */
exports.handler = async (event, context) => {
    // Set up CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*', // Update this in production to your domain
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    };
    
    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }
    
    try {
        // Parse the request body
        const requestBody = JSON.parse(event.body);
        const { fileName, fileType } = requestBody;
        
        // Validate required parameters
        if (!fileName || !fileType) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required parameters: fileName and fileType are required' })
            };
        }
        
        // Create a unique file key with a timestamp and UUID
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uuid = uuidv4();
        const sanitizedFileName = sanitizeFileName(fileName);
        const fileKey = `uploads/${timestamp}-${uuid}-${sanitizedFileName}`;
        
        // Generate pre-signed URL with a 15-minute expiration
        const params = {
            Bucket: BUCKET_NAME,
            Key: fileKey,
            ContentType: fileType,
            Expires: 900 // 15 minutes in seconds
        };
        
        const uploadUrl = await s3.getSignedUrlPromise('putObject', params);
        
        // Return the URL and file key
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                uploadUrl,
                fileKey
            })
        };
    } catch (error) {
        console.error('Error generating pre-signed URL:', error);
        
        // Return error response
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to generate upload URL', message: error.message })
        };
    }
};

/**
 * Sanitize a filename to remove potentially problematic characters
 * @param {string} fileName - The original filename
 * @returns {string} - The sanitized filename
 */
function sanitizeFileName(fileName) {
    // Remove any path-traversal characters
    let sanitized = fileName.replace(/[/\\?%*:|"<>]/g, '-');
    
    // Remove any leading/trailing spaces
    sanitized = sanitized.trim();
    
    // If the filename is now empty, provide a default
    if (!sanitized) {
        sanitized = 'file';
    }
    
    return sanitized;
}
