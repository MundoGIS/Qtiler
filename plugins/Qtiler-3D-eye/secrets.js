import crypto from 'node:crypto';

const SECRET_PREFIX = 'qtiler3d:v1:';

function getEncryptionKey() {
    const configured = String(process.env.QTILER3DEYE_ION_TOKEN_KEY || process.env.QTILER_DATABASE_CREDENTIALS_KEY || '').trim();
    if (!configured) {
        throw new Error('Set QTILER3DEYE_ION_TOKEN_KEY to a 32-byte base64 or 64-character hex key before saving a Cesium Ion token.');
    }
    const key = /^[a-f0-9]{64}$/i.test(configured)
        ? Buffer.from(configured, 'hex')
        : Buffer.from(configured, 'base64');
    if (key.length !== 32) {
        throw new Error('QTILER3DEYE_ION_TOKEN_KEY must be a 32-byte base64 value or a 64-character hex key.');
    }
    return Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), 'Qtiler-3D-eye Cesium Ion token v1', 32));
}

export function encryptIonToken(value) {
    const token = String(value || '').trim();
    if (!token) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return `${SECRET_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptIonToken(value) {
    const token = String(value || '').trim();
    if (!token.startsWith(SECRET_PREFIX)) return token;
    const [ivText, tagText, ciphertextText] = token.slice(SECRET_PREFIX.length).split(':');
    if (!ivText || !tagText || !ciphertextText) throw new Error('Stored Cesium Ion token has an invalid encrypted format.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivText, 'base64'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertextText, 'base64')),
        decipher.final()
    ]).toString('utf8');
}
