import './firebase.js';
import { onRequest } from "firebase-functions/v2/https";
import { getStorage } from 'firebase-admin/storage';
import archiver from 'archiver';
import path from 'path';
import os from 'os';
import fs from 'fs';

const storage = getStorage();
const bucket = storage.bucket();

export const zipVideos = onRequest({ cors: true, timeoutSeconds: 540, memory: '1GiB' }, async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const { videoPaths } = req.body;

    if (!videoPaths || !Array.isArray(videoPaths) || videoPaths.length === 0) {
        return res.status(400).send('Missing required parameter: videoPaths array.');
    }

    const zipId = `video-archive-${Date.now()}`;
    const tempDir = path.join(os.tmpdir(), zipId);
    const zipFilePath = path.join(os.tmpdir(), `${zipId}.zip`);

    try {
        fs.mkdirSync(tempDir, { recursive: true });

        // Download all videos from storage
        const downloadPromises = videoPaths.map(filePath => {
            const fileName = path.basename(filePath);
            const localPath = path.join(tempDir, fileName);
            return bucket.file(filePath).download({ destination: localPath });
        });
        await Promise.all(downloadPromises);

        // Create a zip archive
        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipFilePath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', resolve);
            archive.on('error', reject);

            archive.pipe(output);
            archive.directory(tempDir, false);
            archive.finalize();
        });

        // Upload the zip file to storage
        const destinationPath = `zips/${zipId}.zip`;
        const [file] = await bucket.upload(zipFilePath, {
            destination: destinationPath,
            metadata: { contentType: 'application/zip' }
        });

        // Get a signed URL for the zip file
        const signedUrl = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        });

        res.status(200).send({ zipUrl: signedUrl[0] });

    } catch (error) {
        console.error('Error creating zip file:', error);
        res.status(500).send('Failed to create zip file.');
    } finally {
        // Clean up local files
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        if (fs.existsSync(zipFilePath)) {
            fs.unlinkSync(zipFilePath);
        }
    }
});
