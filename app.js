import { OPENROUTER_API_KEY, MODEL_NAME } from './api_key.js';

// ... (باقي تعريفات العناصر والمتغيرات كما هي) ...

// --- Utility Functions ---

// ... (الدوال المساعدة كما هي، بما في ذلك showStatus, toggleLoading, resizeImage) ...

/**
 * Converts a Data URL (base64) to an HTMLImageElement and then resizes it to a canvas.
 * This is useful if your maskDataURL is not coming directly from a canvas.
 * @param {string} dataURL - The data URL (e.g., 'data:image/png;base64,...').
 * @param {number} maxWidth - Max width for resizing.
 * @param {number} maxHeight - Max height for resizing.
 * @returns {Promise<HTMLCanvasElement>} - A promise that resolves with the resized image on a canvas.
 */
async function resizeImageFromDataURL(dataURL, maxWidth, maxHeight) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const resizedCanvas = resizeImage(img, maxWidth, maxHeight);
            resolve(resizedCanvas);
        };
        img.onerror = reject;
        img.src = dataURL;
    });
}


// ... (باقي الدوال المساعدة) ...

// --- Mask Processing ---

/**
 * Creates a PNG Blob of the mask with alpha channel.
 * White (255,255,255,255) for painted areas, transparent for unpainted.
 * Applies feathering if enabled.
 * @returns {Promise<Blob>} - A promise that resolves with the mask PNG Blob.
 */
async function getMaskAsPngBlob() {
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
        // Adjust the color detection if your mask's red color varies.
        // A simple check for a non-transparent pixel in the maskCtx could be more robust.
        if (data[i+3] > 0) { // If pixel is not fully transparent (meaning it was drawn)
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
        const blurRadius = 10;
        const blurCanvas = document.createElement('canvas');
        blurCanvas.width = tempCanvas.width;
        blurCanvas.height = tempCanvas.height;
        const blurCtx = blurCanvas.getContext('2d');

        blurCtx.filter = `blur(${blurRadius}px)`;
        blurCtx.drawImage(tempCanvas, 0, 0);

        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(blurCanvas, 0, 0);
    }

    // Convert the processed mask to PNG Blob
    return new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
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
        const MAX_API_IMAGE_DIMENSION = 1024; // Max dimension for API upload

        // Resize original image
        const resizedOriginalCanvas = resizeImage(originalImage, MAX_API_IMAGE_DIMENSION, MAX_API_IMAGE_DIMENSION);
        const originalImageBlob = await new Promise(resolve => resizedOriginalCanvas.toBlob(resolve, 'image/jpeg', 0.9));

        // Get the mask as a Blob
        const maskBlob = await getMaskAsPngBlob();
        // The mask Blob already represents the drawn mask, potentially feathered.
        // We might need to resize it if the original canvas was much larger than MAX_API_IMAGE_DIMENSION.
        // For simplicity, we are assuming maskCanvas and imageCanvas are already scaled for display.
        // If originalImage is much larger, the mask should ideally be drawn on a full-res canvas.
        // For robustness, let's resize the mask Blob too to match the resized image.
        const maskDataURL = URL.createObjectURL(maskBlob); // Convert Blob to DataURL temporarily for resizeImageFromDataURL
        const resizedMaskCanvas = await resizeImageFromDataURL(maskDataURL, MAX_API_IMAGE_DIMENSION, MAX_API_IMAGE_DIMENSION);
        const resizedMaskBlob = await new Promise(resolve => resizedMaskCanvas.toBlob(resolve, 'image/png'));
        URL.revokeObjectURL(maskDataURL); // Clean up the temporary object URL

        // Create FormData for multipart/form-data request
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('image', originalImageBlob, 'original_image.jpeg');
        formData.append('mask', resizedMaskBlob, 'mask.png');


        const response = await fetch('https://openrouter.ai/api/v1/generation', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                // 'Content-Type': 'multipart/form-data' is set automatically by browser for FormData
                // If using the proxy, remove the Authorization header here, as proxy will add it.
            },
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenRouter API Error: ${response.status} - ${errorData.message || response.statusText}`);
        }

        const data = await response.json();
        // Assuming data.choices[0].message.content or similar for an image URL from a vision model
        // OpenRouter's API for generation of images might return different structure for image outputs.
        // For Gemini Vision Pro, it typically returns content with images base64 encoded or URLs.
        // You might need to inspect the 'data' structure from a successful response to get the exact path.
        // For example, it might be data.choices[0].message.content[0].image_url or data.data[0].url etc.
        // Let's assume a common structure for image generation services.
        const imageUrl = data.data && data.data[0] && data.data[0].url ? data.data[0].url : null;

        if (!imageUrl) {
            // If the model is purely a text model, it might return text content.
            // For Gemini Vision, it should return an image URL or base64.
            // For image editing, specific models like Stability Diffusion usually return an image URL.
            // This is a common point of error where the response structure isn't as expected.
            throw new Error('لم يتم تلقي صورة أو عنوان URL صالح من API. تحقق من استجابة النموذج.');
        }

        const editedImage = new Image();
        editedImage.onload = async () => { // Make this async to await mask image loading
            // Composite the edited image over the original using the mask
            // We need the original mask data URL for compositing, so we recreate it.
            const maskForCompositingBlob = await getMaskAsPngBlob();
            const maskForCompositingDataURL = URL.createObjectURL(maskForCompositingBlob);

            compositeImages(editedImage, originalImage, maskForCompositingDataURL);

            URL.revokeObjectURL(maskForCompositingDataURL); // Clean up temp URL

            showStatus('تم التعديل بنجاح!', 'success');
            resultSection.style.display = 'block';
            resultImage.src = imageCanvas.toDataURL(); // Display the composited image
            toggleLoading(false);
        };
        editedImage.onerror = () => {
            throw new Error('فشل تحميل الصورة المعدلة من API. قد يكون الرابط غير صالح.');
        };
        editedImage.src = imageUrl;

    } catch (error) {
        console.error('API Error:', error);
        showStatus(`خطأ في الاتصال أو الخادم: ${error.message}`, 'error');
        toggleLoading(false);
    }
}

// ... (باقي كود app.js كما هو، بما في ذلك compositeImages و Event Listeners) ...
