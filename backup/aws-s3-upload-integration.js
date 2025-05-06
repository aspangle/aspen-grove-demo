/**
 * AWS S3 Upload Integration for Aspen Grove Services
 * This module provides functionality for secure large file uploads directly to S3
 */

class AspenGroveS3Upload {
    constructor(config) {
        this.config = {
            region: config.region || 'us-east-1',
            apiEndpoint: config.apiEndpoint || '/api/get-upload-url',
            maxFileSize: config.maxFileSize || 5242880000, // 5GB (S3's maximum single upload size)
            allowedFileTypes: config.allowedFileTypes || ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'],
            onProgress: config.onProgress || function() {},
            onSuccess: config.onSuccess || function() {},
            onError: config.onError || function() {},
            onComplete: config.onComplete || function() {}
        };
        
        // Create a map to store all active uploads
        this.uploads = new Map();
        this.uploadId = 0;
    }
    
    /**
     * Initialize the uploader with DOM elements
     * @param {Element} dropZone - The drag and drop zone element
     * @param {Element} fileInput - The file input element
     * @param {Element} uploadButton - The upload button element
     */
    init(dropZone, fileInput, uploadButton) {
        this.dropZone = dropZone;
        this.fileInput = fileInput;
        this.uploadButton = uploadButton;
        
        this._setupEventListeners();
    }
    
    /**
     * Set up event listeners for the uploader
     * @private
     */
    _setupEventListeners() {
        // Drag and drop functionality
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, this._preventDefaults, false);
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => {
                this.dropZone.classList.add('dragover');
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => {
                this.dropZone.classList.remove('dragover');
            });
        });
        
        // Handle file drop
        this.dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            this.addFiles(files);
        });
        
        // Handle file selection
        this.fileInput.addEventListener('change', (e) => {
            this.addFiles(e.target.files);
        });
        
        // Handle upload button click
        if (this.uploadButton) {
            this.uploadButton.addEventListener('click', () => {
                this.uploadAll();
            });
        }
    }
    
    /**
     * Prevent default behavior for events
     * @private
     */
    _preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    /**
     * Add files to the upload queue
     * @param {FileList} fileList - The list of files to add
     */
    addFiles(fileList) {
        Array.from(fileList).forEach(file => {
            // Validate file size
            if (file.size > this.config.maxFileSize) {
                this.config.onError({
                    file: file,
                    message: `File ${file.name} exceeds the maximum file size of ${this._formatSize(this.config.maxFileSize)}`
                });
                return;
            }
            
            // Validate file type
            if (!this.config.allowedFileTypes.includes(file.type)) {
                this.config.onError({
                    file: file,
                    message: `File ${file.name} is not a supported format`
                });
                return;
            }
            
            // Generate a unique ID for this upload
            const uploadId = ++this.uploadId;
            
            // Store the file in the uploads map
            this.uploads.set(uploadId, {
                id: uploadId,
                file: file,
                progress: 0,
                status: 'pending'
            });
            
            // Notify about the new file
            this.config.onSuccess({
                uploadId: uploadId,
                file: file,
                status: 'added'
            });
        });
    }
    
    /**
     * Upload all pending files in the queue
     */
    uploadAll() {
        // Count pending uploads
        let pendingUploads = 0;
        this.uploads.forEach(upload => {
            if (upload.status === 'pending') {
                pendingUploads++;
            }
        });
        
        if (pendingUploads === 0) {
            return;
        }
        
        // Upload each pending file
        this.uploads.forEach(upload => {
            if (upload.status === 'pending') {
                this._uploadFile(upload.id);
            }
        });
    }
    
    /**
     * Remove a file from the upload queue
     * @param {number} uploadId - The ID of the upload to remove
     */
    removeFile(uploadId) {
        if (this.uploads.has(uploadId)) {
            const upload = this.uploads.get(uploadId);
            
            // Only remove if not currently uploading
            if (upload.status !== 'uploading') {
                this.uploads.delete(uploadId);
                return true;
            }
        }
        return false;
    }
    
    /**
     * Upload a specific file
     * @param {number} uploadId - The ID of the upload to process
     * @private
     */
    async _uploadFile(uploadId) {
        if (!this.uploads.has(uploadId)) {
            return;
        }
        
        const upload = this.uploads.get(uploadId);
        const file = upload.file;
        
        // Update status to uploading
        upload.status = 'uploading';
        this.uploads.set(uploadId, upload);
        
        try {
            // Step 1: Get pre-signed URL from server
            const presignedUrl = await this._getPresignedUrl(file.name, file.type);
            
            // Step 2: Upload directly to S3
            await this._uploadToS3(uploadId, file, presignedUrl);
            
            // Update status to completed
            upload.status = 'completed';
            upload.progress = 100;
            this.uploads.set(uploadId, upload);
            
            // Notify success
            this.config.onSuccess({
                uploadId: uploadId,
                file: file,
                status: 'completed',
                fileKey: presignedUrl.fileKey
            });
            
            // Check if all uploads are complete
            this._checkAllCompleted();
        } catch (error) {
            console.error('Error uploading file:', error);
            
            // Update status to error
            upload.status = 'error';
            upload.error = error.message;
            this.uploads.set(uploadId, upload);
            
            // Notify error
            this.config.onError({
                uploadId: uploadId,
                file: file,
                message: error.message
            });
        }
    }
    
    /**
     * Get a pre-signed URL from the server
     * @param {string} fileName - The name of the file
     * @param {string} fileType - The MIME type of the file
     * @returns {Promise<object>} - A promise that resolves to the pre-signed URL data
     * @private
     */
    async _getPresignedUrl(fileName, fileType) {
        try {
            const response = await fetch(this.config.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fileName: fileName,
                    fileType: fileType
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to get upload URL: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            throw new Error(`Error getting pre-signed URL: ${error.message}`);
        }
    }
    
    /**
     * Upload a file directly to S3 using a pre-signed URL
     * @param {number} uploadId - The ID of the upload
     * @param {File} file - The file to upload
     * @param {object} presignedData - The pre-signed URL data
     * @returns {Promise<void>} - A promise that resolves when the upload is complete
     * @private
     */
    async _uploadToS3(uploadId, file, presignedData) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            // Setup progress tracking
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percentComplete = (event.loaded / event.total) * 100;
                    
                    // Update progress in the uploads map
                    const upload = this.uploads.get(uploadId);
                    upload.progress = percentComplete;
                    this.uploads.set(uploadId, upload);
                    
                    // Notify progress
                    this.config.onProgress({
                        uploadId: uploadId,
                        file: file,
                        progress: percentComplete
                    });
                }
            });
            
            // Setup completion handler
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve();
                } else {
                    reject(new Error(`Upload failed with status: ${xhr.status}`));
                }
            });
            
            // Setup error handler
            xhr.addEventListener('error', () => {
                reject(new Error('Network error occurred during upload'));
            });
            
            // Setup abort handler
            xhr.addEventListener('abort', () => {
                reject(new Error('Upload was aborted'));
            });
            
            // Send the request
            xhr.open('PUT', presignedData.uploadUrl);
            xhr.setRequestHeader('Content-Type', file.type);
            xhr.send(file);
        });
    }
    
    /**
     * Check if all uploads are completed
     * @private
     */
    _checkAllCompleted() {
        let allCompleted = true;
        let uploadCount = 0;
        let completedCount = 0;
        
        this.uploads.forEach(upload => {
            uploadCount++;
            if (upload.status === 'completed') {
                completedCount++;
            } else if (upload.status !== 'error') {
                allCompleted = false;
            }
        });
        
        if (uploadCount > 0 && allCompleted) {
            this.config.onComplete({
                totalUploads: uploadCount,
                completedUploads: completedCount,
                failedUploads: uploadCount - completedCount
            });
        }
    }
    
    /**
     * Format file size for display
     * @param {number} bytes - The size in bytes
     * @returns {string} - The formatted size
     * @private
     */
    _formatSize(bytes) {
        if (bytes < 1024) {
            return bytes + ' bytes';
        } else if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(1) + ' KB';
        } else if (bytes < 1024 * 1024 * 1024) {
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        } else {
            return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
        }
    }
}

// Example usage with the portal
document.addEventListener('DOMContentLoaded', function() {
    // This code shows how to integrate the S3 uploader with the existing portal

    // 1. Create an instance of the uploader
    const s3Uploader = new AspenGroveS3Upload({
        region: 'us-east-1',
        apiEndpoint: '/api/get-upload-url',
        maxFileSize: 209715200, // 200MB per file
        allowedFileTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'],
        onProgress: function(data) {
            // Update the UI with progress
            const progressElement = document.querySelector(`#file-${data.uploadId} .progress`);
            if (progressElement) {
                progressElement.style.width = `${data.progress}%`;
            }
        },
        onSuccess: function(data) {
            if (data.status === 'added') {
                // Create a new file item in the UI
                const fileList = document.getElementById('file-list');
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.id = `file-${data.uploadId}`;
                
                fileItem.innerHTML = `
                    <div class="file-name">${data.file.name}</div>
                    <div class="file-size">${formatSize(data.file.size)}</div>
                    <div class="progress-wrapper">
                        <div class="progress-bar">
                            <div class="progress" style="width: 0%"></div>
                        </div>
                    </div>
                    <button class="icon-button" title="Remove" data-id="${data.uploadId}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
                            <path fill="none" d="M0 0h24v24H0z"/>
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                `;
                
                fileList.appendChild(fileItem);
                
                // Setup remove button listener
                const removeButton = fileItem.querySelector('.icon-button');
                removeButton.addEventListener('click', function() {
                    const uploadId = parseInt(this.dataset.id);
                    if (s3Uploader.removeFile(uploadId)) {
                        fileItem.remove();
                        
                        // Hide upload button if no files
                        if (fileList.children.length === 0) {
                            document.getElementById('upload-button').style.display = 'none';
                        }
                    }
                });
                
                // Show upload button
                document.getElementById('upload-button').style.display = 'block';
            } else if (data.status === 'completed') {
                // Update UI to show completed status
                const fileItem = document.getElementById(`file-${data.uploadId}`);
                if (fileItem) {
                    // You could add a completion indicator here
                    fileItem.classList.add('completed');
                }
            }
        },
        onError: function(data) {
            // Display error message
            document.getElementById('status-message').textContent = data.message;
            document.getElementById('status-message').className = 'status-message status-error';
            document.getElementById('status-message').style.display = 'block';
            
            // Update UI for the file with error
            if (data.uploadId) {
                const fileItem = document.getElementById(`file-${data.uploadId}`);
                if (fileItem) {
                    fileItem.classList.add('error');
                }
            }
        },
        onComplete: function(data) {
            // All uploads completed
            document.getElementById('status-message').textContent = `All files uploaded successfully! (${data.completedUploads}/${data.totalUploads})`;
            document.getElementById('status-message').className = 'status-message status-success';
            document.getElementById('status-message').style.display = 'block';
            
            // Auto-hide after 5 seconds
            setTimeout(() => {
                document.getElementById('status-message').style.display = 'none';
                
                // Clear file list
                document.getElementById('file-list').innerHTML = '';
                
                // Hide upload button
                document.getElementById('upload-button').style.display = 'none';
            }, 5000);
        }
    });
    
    // 2. Initialize the uploader with DOM elements
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const uploadButton = document.getElementById('upload-button');
    
    if (uploadArea && fileInput && uploadButton) {
        s3Uploader.init(uploadArea, fileInput, uploadButton);
    }
    
    // Helper function to format file size
    function formatSize(bytes) {
        if (bytes < 1024) {
            return bytes + ' bytes';
        } else if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(1) + ' KB';
        } else {
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }
    }
});
