const { describe, expect, test } = require('bun:test');
const path = require('path');
const { pathModuleSafeJoin, securityHeaders } = require('../src/web/server');

describe('web production boundaries', () => {
    test('prevents static path traversal', () => {
        const root = '/app/dist/web';
        expect(pathModuleSafeJoin(root, 'assets/app.js')).toBe(path.join(root, 'assets/app.js'));
        expect(pathModuleSafeJoin(root, '../../secret')).toBeNull();
    });

    test('sets restrictive browser security headers', () => {
        const headers = securityHeaders();
        expect(headers['x-frame-options']).toBe('DENY');
        expect(headers['content-security-policy']).toContain("default-src 'self'");
    });
});
