/**
 * テスト用に、合成した RSA 鍵で Cognito 形式のアクセストークンを発行する。
 *
 * JWKS を取得しに行かず、実際の署名検証の経路を通したテストを書くためのもの。
 * 本番コードから import しない。
 */
import { generateKeyPairSync, sign } from 'node:crypto';
export function createTestTokenIssuer(options) {
    const region = options.userPoolId.split('_')[0];
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${options.userPoolId}`;
    const kid = 'aws-kit-test-key';
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwks = {
        keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }],
    };
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return {
        jwks,
        issuer,
        accessToken(claims = {}) {
            const now = Math.floor(Date.now() / 1000);
            const body = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode({
                sub: 'test-sub',
                iss: issuer,
                client_id: options.clientId,
                token_use: 'access',
                username: 'test-user',
                iat: now,
                exp: now + 600,
                ...claims,
            })}`;
            return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
        },
    };
}
