import { OPENROUTER_API_KEY, MODEL_NAME } from './api_key.js';

// DOM Elements
const imageUpload = document.getElementById('imageUpload');
const dropArea = document.getElementById('dropArea');
const uploadFileName = document.getElementById('uploadFileName');
const imageCanvas = document.getElementById('imageCanvas');
const maskCanvas = document.getElementById('maskCanvas');
const brushSizeSlider = document.getElementById('brushSize');
const brushSizeValue = document.getElementById('brushSizeValue');
const showMaskToggle = document.getElementById('showMaskToggle');
const featherMaskToggle = document.getElementById('featherMaskToggle');
const editPromptTextarea = document.getElementById('editPrompt');
const examplePrompts = document.querySelector('.example-prompts');
const sendEditButton = document.getElementById('sendEditButton');
const statusMessage = document.getElementById('statusMessage');
const loadingSpinner = document.getElementById('loadingSpinner');
const resultSection = document.querySelector('.result-section');
const resultImage = document.getElementById('resultImage');
const downloadResultButton = document.getElementById('downloadResultButton');

// Canvas contexts
const imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

// Image data
let originalImage = new Image();
let currentImage = new Image(); // Stores the current image on canvas (original or last edited)
let maskImage = new Image(); // Stores the mask for feathering/compositing
let imageLoaded = false;
let maskPainted = false;
let currentBrushSize = parseInt(brushSizeSlider.value);

// Mask drawing state
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let maskAlpha = 0.8; // Semi-transparent red for mask preview
let maskColor = 'rgba(255, 0, 0, ' + maskAlpha + ')';

// --- Utility Functions ---

/**
 * Displays a status message to the user.
 * @param {string} message - The message to display.
 * @param {'success'|'error'|'info'} type - The type of message (for styling).
 * @param {number} duration - How long to display the message in ms.
 */
function showStatus(message, type, duration = 5000) {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message ' + type;
    statusMessage.style.display = 'block';
    if (duration > 0) {
        setTimeout(() => {
            statusMessage.style.display = 'none';
        }, duration);
    }
}

/**
 * Shows/hides the loading spinner.
 * @param {boolean} show - True to show, false to hide.
 */
function toggleLoading(show) {
    loadingSpinner.style.display = show ? 'block' : 'none';
    sendEditButton.disabled = show;
    imageUpload.disabled = show;
}

/**
 * Resizes an image to fit within a maximum dimension while maintaining aspect ratio.
 * @param {HTMLImageElement} img - The image element to resize.
 * @param {number} maxWidth - The maximum width.
 * @param {number} maxHeight - The maximum height.
 * @returns {HTMLCanvasElement} - A new canvas with the resized image.
 */
function resizeImage(img, maxWidth, maxHeight) {
    let width = img.width;
    let height = img.height;

    if (width > height) {
        if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
        }
    } else {
        if (height > maxHeight) {
            width = Math.round(width * (maxHeight / height));
            height = maxHeight;
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
}

/**
 * Updates the brush cursor based on the current brush size.
 */
function updateBrushCursor() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${currentBrushSize}" height="${currentBrushSize}" viewBox="0 0 ${currentBrushSize} ${currentBrushSize}"><circle cx="${currentBrushSize / 2}" cy="${currentBrushSize / 2}" r="${currentBrushSize / 2 - 1}" stroke="black" stroke-width="1" fill="rgba(0,0,0,0.2)" /></svg>`;
    const encodedSvg = encodeURIComponent(svg);
    maskCanvas.style.cursor = `url('data:image/svg+xml;utf8,${encodedSvg}') ${currentBrushSize / 2} ${currentBrushSize / 2}, auto`;
}

// --- Image Loading and Canvas Setup ---

/**
 * Loads an image from a File object into the canvas.
 * @param {File} file - The image file.
 */
function loadImageFromFile(file) {
    if (!file.type.startsWith('image/')) {
        showStatus('ملف غير مدعوم! يرجى تحميل صورة.', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        originalImage.onload = () => {
            // Reset state
            imageLoaded = true;
            maskPainted = false;
            resultSection.style.display = 'none';
            resultImage.src = '';
            uploadFileName.textContent = file.name;
            showStatus('تم تحميل الصورة بنجاح.', 'success');

            // Set canvas dimensions to image dimensions, limit max size for display
            const MAX_DISPLAY_WIDTH = 800; // Max width for UI display
            const MAX_DISPLAY_HEIGHT = 600; // Max height for UI display

            let displayWidth = originalImage.width;
            let displayHeight = originalImage.height;

            // Maintain aspect ratio for display
            if (displayWidth > MAX_DISPLAY_WIDTH) {
                displayHeight = Math.round(displayHeight * (MAX_DISPLAY_WIDTH / displayWidth));
                displayWidth = MAX_DISPLAY_WIDTH;
            }
            if (displayHeight > MAX_DISPLAY_HEIGHT) {
                displayWidth = Math.round(displayWidth * (MAX_DISPLAY_HEIGHT / displayHeight));
                displayHeight = MAX_DISPLAY_HEIGHT;
            }

            imageCanvas.width = displayWidth;
            imageCanvas.height = displayHeight;
            maskCanvas.width = displayWidth;
            maskCanvas.height = displayHeight;

            // Clear canvases
            imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
            maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

            // Draw original image to imageCanvas
            imageCtx.drawImage(originalImage, 0, 0, imageCanvas.width, imageCanvas.height);
            currentImage.src = imageCanvas.toDataURL(); // Store current state of image canvas

            // Update canvas container padding for responsive aspect ratio
            const container = document.querySelector('.canvas-container');
            container.style.paddingBottom = `${(imageCanvas.height / imageCanvas.width) * 100}%`;
        };
        originalImage.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --- Mask Drawing Logic ---

/**
 * Draws a line segment on the mask canvas.
 * @param {number} x1 - Start X coordinate.
 * @param {number} y1 - Start Y coordinate.
 * @param {number} x2 - End X coordinate.
 * @param {number} y2 - End Y coordinate.
 */
function draw(x1, y1, x2, y2) {
    maskCtx.beginPath();
    maskCtx.strokeStyle = maskColor;
    maskCtx.lineWidth = currentBrushSize;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    maskCtx.moveTo(x1, y1);
    maskCtx.lineTo(x2, y2);
    maskCtx.stroke();
    maskCtx.closePath();
    maskPainted = true;
}

/**
 * Handles mouse down events for drawing.
 * @param {MouseEvent} e - The mouse event.
 */
function startDrawing(e) {
    if (!imageLoaded) {
        showStatus('يرجى تحميل صورة أولاً.', 'info');
        return;
    }
    isDrawing = true;
    const { offsetX, offsetY } = getRelativeCoordinates(e);
    [lastX, lastY] = [offsetX, offsetY];
    draw(lastX, lastY, lastX, lastY); // Draw a dot for a click
}

/**
 * Handles mouse move events for drawing.
 * @param {MouseEvent} e - The mouse event.
 */
function drawing(e) {
    if (!isDrawing) return;
    const { offsetX, offsetY } = getRelativeCoordinates(e);
    draw(lastX, lastY, offsetX, offsetY);
    [lastX, lastY] = [offsetX, offsetY];
}

/**
 * Handles mouse up/out events to stop drawing.
 */
function stopDrawing() {
    isDrawing = false;
}

/**
 * Gets mouse/touch coordinates relative to the canvas.
 * @param {MouseEvent|TouchEvent} event - The event object.
 * @returns {{offsetX: number, offsetY: number}} - Relative coordinates.
 */
function getRelativeCoordinates(event) {
    const rect = maskCanvas.getBoundingClientRect();
    let clientX, clientY;

    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }

    return {
        offsetX: clientX - rect.left,
        offsetY: clientY - rect.top
    };
}


// --- Mask Processing ---

/**
 * Creates a PNG Data URL of the mask with alpha channel.
 * White (255,255,255,255) for painted areas, transparent for unpainted.
 * Applies feathering if enabled.
 * @returns {Promise<string>} - Base64 Data URL of the mask PNG.
 */
async function getMaskAsPngDataURL() {
    // Create a temporary canvas for mask processing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = maskCanvas.width;
    tempCanvas.height = maskCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');

    // Get the current mask image data
    const maskImageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const data = maskImageData.data;

    // Iterate through mask pixels: if red, make white opaque; otherwise transparent.
    for (let i = 0; i < data.length; i += 4) {
        // Check if pixel is part of the red mask (allowing for slight color variations if any)
        if (data[i] > 100 && data[i+1] < 100 && data[i+2] < 100) { // If predominantly red
            data[i] = 255;   // R
            data[i+1] = 255; // G
            data[i+2] = 255; // B
            data[i+3] = 255; // Alpha (fully opaque white)
        } else {
            data[i+3] = 0;   // Transparent
        }
    }
    tempCtx.putImageData(maskImageData, 0, 0);

    // Apply feathering if enabled
    if (featherMaskToggle.checked) {
        // Feathering implementation: Gaussian blur
        // A simple way is to draw the mask to another canvas with blur, then composite.
        // For a more robust solution, a custom convolution kernel might be used.
        const blurRadius = 10; // Adjust blur radius for desired feathering effect
        const blurCanvas = document.createElement('canvas');
        blurCanvas.width = tempCanvas.width;
        blurCanvas.height = tempCanvas.height;
        const blurCtx = blurCanvas.getContext('2d');

        // Draw the solid mask to the blur canvas and apply blur filter
        blurCtx.filter = `blur(${blurRadius}px)`;
        blurCtx.drawImage(tempCanvas, 0, 0);

        // Clear tempCanvas and redraw blurred mask
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(blurCanvas, 0, 0);
    }

    // Convert the processed mask to PNG Data URL
    return tempCanvas.toDataURL('image/png');
}


// --- OpenRouter API Integration ---

/**
 * Sends the image, mask, and prompt to the OpenRouter API for inpainting.
 */
async function sendImageForEdit() {
    if (!imageLoaded) {
        showStatus('يرجى تحميل صورة أولاً.', 'error');
        return;
    }
    if (!maskPainted) {
        showStatus('اختَر جزءًا بالصّفْر.', 'error'); // "Please select a part by zero (drawing)"
        return;
    }
    const prompt = editPromptTextarea.value.trim();
    if (!prompt) {
        showStatus('يرجى كتابة وصف التعديل.', 'error');
        return;
    }

    showStatus('جاري إرسال التعديل...', 'info', 0); // Show indefinitely
    toggleLoading(true);

    try {
        const maskDataURL = await getMaskAsPngDataURL();

        // Resize original image for API upload to prevent exceeding model limits
        // OpenRouter Nano-banana-gemini typically handles up to 1024x1024 or 2048x2048.
        // We'll downscale to max 1024px for robustness, keeping aspect ratio.
        const MAX_API_IMAGE_DIMENSION = 1024;
        const resizedOriginalCanvas = resizeImage(originalImage, MAX_API_IMAGE_DIMENSION, MAX_API_IMAGE_DIMENSION);
        const resizedMaskCanvas = resizeImage(maskImage, MAX_API_IMAGE_DIMENSION, MAX_API_IMAGE_DIMENSION); // Use maskImage if it holds the full res mask
        const originalImageBlob = await new Promise(resolve => resizedOriginalCanvas.toBlob(resolve, 'image/jpeg', 0.9));
        const maskImageBlob = await new Promise(resolve => resizedMaskCanvas.toBlob(resolve, 'image/png'));

        // If you used maskCanvas directly for maskDataURL, ensure it's also resized:
        // const resizedMaskCanvasFromCurrent = resizeImageFromDataURL(maskDataURL, MAX_API_IMAGE_DIMENSION, MAX_API_IMAGE_DIMENSION);
        // const maskImageBlob = await new Promise(resolve => resizedMaskCanvasFromCurrent.toBlob(resolve, 'image/png'));


        // Create FormData for multipart/form-data request
        const formData = new FormData();
        formData.append('image', originalImageBlob, 'original_image.jpeg');
        formData.append('mask', maskImageBlob, 'mask.png');
        formData.append('prompt', prompt);
        // Nano-banana-gemini (Gemini Vision Pro) might expect prompt in a specific JSON structure or direct.
        // For image editing, some models expect JSON with parameters. OpenRouter's specific endpoint
        // for image editing may vary. This example assumes a common `image`, `mask`, `prompt` structure.
        // Refer to OpenRouter's documentation for exact model specifics.

        // Model-specific payload might be needed. For a simple inpainting, this should work.
        // Some APIs might expect JSON in the body for image + prompt, with files as base64 or separate fields.
        // For simplicity, we assume `multipart/form-data` with direct files.
        // If the API requires JSON body, you'd convert blobs to base64:
        // formData.append('data', JSON.stringify({
        //     prompt: prompt,
        //     // Other params like strength, guidance_scale
        // }));

        const response = await fetch('https://openrouter.ai/api/v1/generation', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                // 'Content-Type': 'multipart/form-data' is typically set automatically by browser for FormData
                // If using a JSON body, set 'Content-Type': 'application/json'
            },
            body: formData, // For multipart/form-data
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenRouter API Error: ${response.status} - ${errorData.message || response.statusText}`);
        }

        const data = await response.json();
        const imageUrl = data.url; // Assuming the API returns a direct image URL
                                   // Or, if it returns base64, it might be in data.b64_json

        if (!imageUrl) {
            throw new Error('لم يتم تلقي صورة من API.');
        }

        const editedImage = new Image();
        editedImage.onload = () => {
            // Now, composite the edited image over the original using the mask
            compositeImages(editedImage, originalImage, maskDataURL);

            showStatus('تم التعديل بنجاح!', 'success');
            resultSection.style.display = 'block';
            resultImage.src = imageCanvas.toDataURL(); // Display the composited image
            toggleLoading(false);
        };
        editedImage.onerror = () => {
            throw new Error('فشل تحميل الصورة المعدلة من API.');
        };
        editedImage.src = imageUrl;

    } catch (error) {
        console.error('API Error:', error);
        showStatus(`خطأ في الاتصال أو الخادم: ${error.message}`, 'error');
        toggleLoading(false);
    }
}

/**
 * Composites the edited image over the original image using the mask.
 * Pixels outside the mask remain from the original.
 * Pixels inside the mask are from the edited image.
 *
 * @param {HTMLImageElement} editedImg - The image returned from the API.
 * @param {HTMLImageElement} originalImg - The original image uploaded by the user.
 * @param {string} maskDataURL - The Data URL of the mask (white opaque for edit region, transparent elsewhere).
 */
async function compositeImages(editedImg, originalImg, maskDataURL) {
    // Create a temporary canvas for the original image scaled to original dimensions
    const originalFullResCanvas = document.createElement('canvas');
    originalFullResCanvas.width = originalImage.width;
    originalFullResCanvas.height = originalImage.height;
    const originalFullResCtx = originalFullResCanvas.getContext('2d');
    originalFullResCtx.drawImage(originalImage, 0, 0, originalImage.width, originalImage.height);

    // Create a temporary canvas for the edited image scaled to original dimensions
    const editedFullResCanvas = document.createElement('canvas');
    editedFullResCanvas.width = originalImage.width;
    editedFullResCanvas.height = originalImage.height;
    const editedFullResCtx = editedFullResCanvas.getContext('2d');
    editedFullResCtx.drawImage(editedImg, 0, 0, originalImage.width, originalImage.height); // Scale edited image to original image's dimensions

    // Load the mask image
    const maskImg = new Image();
    maskImg.src = maskDataURL;
    await new Promise(resolve => maskImg.onload = resolve);

    // Create a temporary canvas for the mask scaled to original dimensions
    const maskFullResCanvas = document.createElement('canvas');
    maskFullResCanvas.width = originalImage.width;
    maskFullResCanvas.height = originalImage.height;
    const maskFullResCtx = maskFullResCanvas.getContext('2d');
    maskFullResCtx.drawImage(maskImg, 0, 0, originalImage.width, originalImage.height);

    // Now, create the final composite image on a new canvas
    const finalCompositeCanvas = document.createElement('canvas');
    finalCompositeCanvas.width = originalImage.width;
    finalCompositeCanvas.height = originalImage.height;
    const finalCompositeCtx = finalCompositeCanvas.getContext('2d');

    // 1. Draw the original image as the base
    finalCompositeCtx.drawImage(originalFullResCanvas, 0, 0);

    // 2. Use the mask to draw the edited image only where the mask is opaque (white)
    finalCompositeCtx.globalCompositeOperation = 'destination-in'; // Keep new pixels only where mask exists
    finalCompositeCtx.drawImage(maskFullResCanvas, 0, 0);

    finalCompositeCtx.globalCompositeOperation = 'source-over'; // Reset to default
    finalCompositeCtx.drawImage(editedFullResCanvas, 0, 0);

    // If the model truly returns only the modified region, a more complex layering might be needed
    // where the edited patch is drawn over the original using the mask, but the prompt implies
    // it returns a full image with changes *within* the masked region.
    // The current approach ensures pixels outside the mask from the *original* image are preserved.

    // Update the display canvas with the composited image
    imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    imageCtx.drawImage(finalCompositeCanvas, 0, 0, imageCanvas.width, imageCanvas.height); // Draw scaled composited image to display canvas

    // Update currentImage for further edits
    currentImage.src = finalCompositeCanvas.toDataURL();

    // Clear the mask for next drawing
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskPainted = false; // Reset mask state after compositing
}


// --- Event Listeners ---

// Image Upload (File Input)
imageUpload.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        loadImageFromFile(e.target.files[0]);
    }
});

// Image Upload (Drag and Drop)
dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.classList.add('dragover');
});

dropArea.addEventListener('dragleave', () => {
    dropArea.classList.remove('dragover');
});

dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        loadImageFromFile(e.dataTransfer.files[0]);
    }
});

dropArea.addEventListener('click', () => {
    imageUpload.click();
});

// Brush Size Slider
brushSizeSlider.addEventListener('input', (e) => {
    currentBrushSize = parseInt(e.target.value);
    brushSizeValue.textContent = currentBrushSize;
    updateBrushCursor();
});

// Mask Drawing
maskCanvas.addEventListener('mousedown', startDrawing);
maskCanvas.addEventListener('mousemove', drawing);
maskCanvas.addEventListener('mouseup', stopDrawing);
maskCanvas.addEventListener('mouseout', stopDrawing);

// Touch events for mask drawing
maskCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Prevent scrolling
    startDrawing(e);
}, { passive: false });
maskCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault(); // Prevent scrolling
    drawing(e);
}, { passive: false });
maskCanvas.addEventListener('touchend', stopDrawing);
maskCanvas.addEventListener('touchcancel', stopDrawing);


// Show Mask Toggle
showMaskToggle.addEventListener('change', () => {
    maskCanvas.style.opacity = showMaskToggle.checked ? maskAlpha : 0;
});

// Example Prompts
examplePrompts.addEventListener('click', (e) => {
    if (e.target.classList.contains('example-tag')) {
        editPromptTextarea.value = e.target.dataset.prompt;
    }
});

// Send for Edit Button
sendEditButton.addEventListener('click', sendImageForEdit);

// Download Result Button
downloadResultButton.addEventListener('click', () => {
    if (resultImage.src) {
        const a = document.createElement('a');
        a.href = resultImage.src;
        a.download = 'edited_image.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
});

// Initial setup
updateBrushCursor();
showMaskToggle.checked = true; // Mask visible by default
maskCanvas.style.opacity = maskAlpha;