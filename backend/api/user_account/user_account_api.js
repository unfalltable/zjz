





const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');




const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const svgCaptcha = require('svg-captcha');
const sharp = require('sharp');


const { createClient } = require('redis');
const express = require('express');
const app = express();
app.use(cookieParser());
app.use(express.json());
app.set('trust proxy', true);

const redisClient = createClient({
    url: 'redis://127.0.0.1:6379'
});

redisClient.on('error', (error) => {
    console.error('Redis 错误:', error);
});

redisClient.connect()
    .then(() => {
        console.log('Redis 连接成功');
    })
    .catch((error) => {
        console.error('Redis 连接失败:', error);
    });


const GOOGLE_CLIENT_ID = '888693703784-6ehm7av6ogbf6kc0ckurra9par8rh7v8.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_REDIRECT_URI =
    'http://localhost:3000/api/account/google/callback';

const googleClient = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);


const APPLE_CLIENT_ID = '你的 Apple Services ID';
const APPLE_CLIENT_SECRET = '你的 Apple Client Secret';
const APPLE_REDIRECT_URI =
    'http://localhost:3000/api/account/apple/callback';

//ip限流函数
// ==============================
// IP 访问频率限制
// ==============================

async function checkIpRateLimit(ip, type, limit) {

    const redisKey = `rate_limit:${type}:${ip}`;

    // 次数 +1
    const count = await redisClient.incr(redisKey);

    // 第一次访问时设置 60 秒过期
    if (count === 1) {
        await redisClient.expire(redisKey, 60);
    }

    console.log('==============================');
    console.log('IP 限流检查');
    console.log('IP:', ip);
    console.log('类型:', type);
    console.log('当前次数:', count);
    console.log('限制次数:', limit);
    console.log('==============================');

    // 超过限制
    if (count > limit) {
        return false;
    }

    return true;
}


//网页端google 注册登录

app.get('/api/account/google/login', async (req, res) => {

    console.log('用户请求 Google 登录');

     const googleUrl = googleClient.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'openid',
            'email',
            'profile'
        ]
    });

    console.log('Google 登录地址:', googleUrl);
    //打开这个网址
    res.redirect(googleUrl);

});


app.get('/api/account/google/callback', async (req, res) => {

    console.log('==============================');
    console.log('Google 登录回来了');
    console.log('==============================');

    console.log('Google 回调数据:');
    console.log(req.query);

    try {

        // ==============================
        // ① 获取 Google 返回的 code
        // ==============================

        const code = req.query.code;

        if (!code) {

            return res.status(400).json({
                success: false,
                message: '没有获取到 Google authorization code'
            });

        }

        // ==============================
        // ② 用 code 向 Google 换 Token
        // ==============================

        const { tokens } =
            await googleClient.getToken(code);

        console.log('==============================');
        console.log('Google Token:');
        console.log(tokens);
        console.log('==============================');

        // ==============================
        // ③ 验证 Google ID Token
        // ==============================

        const ticket =
            await googleClient.verifyIdToken({
                idToken: tokens.id_token,
                audience: GOOGLE_CLIENT_ID
            });

        // ==============================
        // ④ 获取 Google 用户信息
        // ==============================

        const payload =
            ticket.getPayload();

        console.log('==============================');
        console.log('Google 用户详细信息:');
        console.log(payload);
        console.log('==============================');

        console.log(
            'Google 用户 ID:',
            payload.sub
        );

        console.log(
            'Google 邮箱:',
            payload.email
        );

        console.log(
            '邮箱是否验证:',
            payload.email_verified
        );

        console.log(
            '用户姓名:',
            payload.name
        );

        console.log(
            '名字:',
            payload.given_name
        );

        console.log(
            '姓氏:',
            payload.family_name
        );

        console.log(
            '头像:',
            payload.picture
        );

        console.log(
            '语言:',
            payload.locale
        );

        // ==============================
        // ⑤ 检查 Google 邮箱
        // ==============================

        if (!payload.email) {

            return res.status(400).json({
                success: false,
                message: 'Google 没有返回邮箱'
            });

        }

        // ==============================
        // ⑥ 检查邮箱是否验证
        // ==============================

        if (!payload.email_verified) {

            return res.status(400).json({
                success: false,
                message: 'Google 邮箱尚未验证'
            });

        }

        // ==============================
        // ⑦ 注册或者登录
        // ==============================
        //
        // 现在还没有数据库
        // 暂时模拟 user_id
        //
        // 以后这里需要：
        //
        // 1. 根据 Google sub 查询用户
        //
        // 2. 如果存在：
        //       直接登录
        //
        // 3. 如果不存在：
        //       创建用户
        //       再登录
        //
        // ==============================

       
        console.log(
            'Google 用户对应 user_id:',
            userId
        );

        // ==============================
        // ⑧ 生成 Token
        // ==============================

        const token =
            crypto.randomBytes(32).toString('hex');

        console.log(
            '生成 Token:',
            token
        );

        // ==============================
        // ⑨ 保存 Token 到 Redis
        // ==============================

        const sessionKey =
            `session:${token}`;

        await redisClient.set(
            sessionKey,
            JSON.stringify({
                user_id: userId,
                account: payload.email,
                account_type: 'google',
                google_id: payload.sub
            }),
            {
                EX: 30 * 24 * 60 * 60
            }
        );

        console.log(
            'Token 已保存到 Redis'
        );

        // ==============================
        // ⑩ 返回登录成功
        // ==============================

        return res.json({

            success: true,

            message: 'Google 注册/登录成功',

            data: {

                user_id: userId,

                token: token,

                expires_in:
                    30 * 24 * 60 * 60,

                google_id:
                    payload.sub,

                email:
                    payload.email,

                name:
                    payload.name || null,

                picture:
                    payload.picture || null

            }

        });

    } catch (error) {

        console.error('==============================');
        console.error('Google 登录失败');
        console.error(error);
        console.error('==============================');

        return res.status(401).json({

            success: false,

            message: 'Google 登录失败',

            error: error.message

        });

    }

});

//app端Google注册登录
// ===============================
// App Google 登录
// ===============================

app.post('/api/account/google/app', async (req, res) => {

    console.log('==============================');
    console.log('App 请求 Google 登录');
    console.log('==============================');

    try {

        const { idToken } = req.body;

        console.log('收到 App 的 Google ID Token');

        // 检查 Token 是否存在
        if (!idToken) {

            return res.status(400).json({
                success: false,
                message: '缺少 Google ID Token'
            });

        }

        // 验证 Google ID Token
        const ticket = await googleClient.verifyIdToken({
            idToken: idToken,
            audience: GOOGLE_CLIENT_ID
        });

        // 获取 Google 用户信息
        const payload = ticket.getPayload();

        console.log('Google 用户信息:');
        console.log('Google 用户 ID:', payload.sub);
        console.log('邮箱:', payload.email);
        console.log('邮箱是否验证:', payload.email_verified);
        console.log('姓名:', payload.name);
        console.log('名字:', payload.given_name);
        console.log('姓氏:', payload.family_name);
        console.log('头像:', payload.picture);
        console.log('语言:', payload.locale);

        // ==============================
        // Google 用户身份
        // ==============================

        const googleUserId = payload.sub;

        // ==============================
        // 暂时没有数据库
        // 这里先模拟一个 user_id
        // ==============================


        console.log('系统用户 ID:');

        // ==============================
        // 生成我们自己系统的 Token
        // ==============================

        const token = crypto.randomBytes(32).toString('hex');

        console.log('生成系统 Token:', token);

        // ==============================
        // 保存登录状态到 Redis
        // ==============================

        const sessionKey = `session:${token}`;

        await redisClient.set(
            sessionKey,
            JSON.stringify({
                user_id: userId,
                login_type: 'google',
                google_id: googleUserId,
                email: payload.email || null
            }),
            {
                EX: 30 * 24 * 60 * 60
            }
        );

        console.log('登录 Token 已保存到 Redis');
        console.log('Redis Key:', sessionKey);

        // ==============================
        // 返回给 App
        // ==============================

        return res.json({
            success: true,
            message: 'Google 注册并登录成功',

            data: {
                user_id: userId,

                token: token,

                expires_in: 30 * 24 * 60 * 60,

                google: {
                    id: googleUserId,
                    email: payload.email || null,
                    email_verified: payload.email_verified || false,
                    name: payload.name || null,
                    given_name: payload.given_name || null,
                    family_name: payload.family_name || null,
                    picture: payload.picture || null,
                    locale: payload.locale || null
                }
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('Google ID Token 验证失败');
        console.error(error);
        console.error('==============================');

        return res.status(401).json({
            success: false,
            message: 'Google 登录失败',
            error: error.message
        });

    }

});


// apple 网页注册登录

// apple  app 网页注册登录



// ===============================
// Apple 网页登录
// ===============================

app.get('/api/account/apple/login', async (req, res) => {

    console.log('用户请求 Apple 登录');

    try {

        const appleUrl = appleSignin.getAuthorizationUrl({
            clientID: APPLE_CLIENT_ID,
            redirectUri: APPLE_REDIRECT_URI,
            scope: 'name email',
            responseMode: 'form_post',
            responseType: 'code'
        });

        console.log('Apple 登录地址:', appleUrl);

        res.redirect(appleUrl);

    } catch (error) {

        console.error('生成 Apple 登录地址失败:', error);

        res.status(500).json({
            success: false,
            message: '生成 Apple 登录地址失败',
            error: error.message
        });

    }

});


// ===============================
// Apple 网页登录回调
// ===============================

app.post('/api/account/apple/callback', async (req, res) => {

    console.log('==============================');
    console.log('Apple 登录回来了');
    console.log('==============================');

    console.log('Apple 返回的数据:', req.body);

    try {

        const {
            code,
            user
        } = req.body;

        // ==============================
        // 检查 authorization code
        // ==============================

        if (!code) {

            return res.status(400).json({
                success: false,
                message: '缺少 Apple authorization code'
            });

        }

        // ==============================
        // 用 authorization code 向 Apple 换取 Token
        // ==============================

        const tokenResponse = await appleSignin.getAuthorizationToken(
            code,
            {
                clientID: APPLE_CLIENT_ID,
                clientSecret: APPLE_CLIENT_SECRET,
                redirectUri: APPLE_REDIRECT_URI
            }
        );

        console.log('Apple Token 获取成功');

        // ==============================
        // 验证 Apple ID Token
        // ==============================

        const appleUser = await appleSignin.verifyIdToken(
            tokenResponse.id_token,
            {
                audience: APPLE_CLIENT_ID
            }
        );

        // ==============================
        // 获取 Apple 用户信息
        // ==============================

        console.log('Apple 用户信息:');

        console.log('Apple 用户 ID:', appleUser.sub);

        console.log('邮箱:', appleUser.email);

        console.log(
            '邮箱是否验证:',
            appleUser.email_verified
        );

        // ==============================
        // Apple 用户唯一 ID
        // ==============================

        const appleUserId = appleUser.sub;

        console.log('Apple 用户唯一 ID:', appleUserId);

        // ==============================
        // 暂时没有数据库
        // 先模拟系统 user_id
        // ==============================

        const userId = 10001;

        console.log('系统用户 ID:', userId);

        // ==============================
        // 生成我们自己系统的 Token
        // ==============================

        const token = crypto.randomBytes(32).toString('hex');

        console.log('生成系统 Token:', token);

        // ==============================
        // 保存登录状态到 Redis
        // ==============================

        const sessionKey = `session:${token}`;

        await redisClient.set(
            sessionKey,
            JSON.stringify({
                user_id: userId,
                login_type: 'apple',
                apple_id: appleUserId,
                email: appleUser.email || null
            }),
            {
                EX: 30 * 24 * 60 * 60
            }
        );

        console.log('登录 Token 已保存到 Redis');

        console.log('Redis Key:', sessionKey);

        // ==============================
        // 注册完成，直接登录
        // ==============================

        return res.json({
            success: true,
            message: 'Apple 注册并登录成功',

            data: {

                user_id: userId,

                token: token,

                expires_in: 30 * 24 * 60 * 60,

                apple: {
                    id: appleUserId,

                    email: appleUser.email || null,

                    email_verified:
                        appleUser.email_verified || false
                }

            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('Apple 登录验证失败');
        console.error(error);
        console.error('==============================');

        return res.status(401).json({
            success: false,
            message: 'Apple 登录失败',
            error: error.message
        });

    }

});

//apple账号的app端应用的登录注册

app.post('/api/account/apple/app', async (req, res) => {

    console.log('==============================');
    console.log('App Apple 登录请求');
    console.log('==============================');

    console.log('App 返回的数据:');
    console.log(req.body);

    try {

        // App 传过来的 Apple identityToken
        const {
            identityToken,
            authorizationCode,
            user,
            email
        } = req.body;

        // 检查 identityToken
        if (!identityToken) {

            return res.status(400).json({
                success: false,
                message: '缺少 Apple identityToken'
            });

        }

        console.log('Apple identityToken:');
        console.log(identityToken);

        console.log('Apple authorizationCode:');
        console.log(authorizationCode);

        console.log('App 返回的 Apple user:');
        console.log(user);

        console.log('App 返回的 email:');
        console.log(email);

        // ==============================
        // 验证 Apple identityToken
        // ==============================

        const appleUser = await appleSignin.verifyIdToken(
            identityToken,
            {
                audience: APPLE_CLIENT_ID
            }
        );

        console.log('==============================');
        console.log('Apple 用户详细信息');
        console.log('==============================');

        console.log('Apple 用户 ID:', appleUser.sub);
        console.log('邮箱:', appleUser.email);
        console.log('邮箱是否验证:', appleUser.email_verified);

        console.log('==============================');

        // ==============================
        // Apple 用户唯一 ID
        // ==============================

        const appleUserId = appleUser.sub;

        console.log('Apple 用户唯一 ID:', appleUserId);

        // ==============================
        // 邮箱
        // ==============================

        // 优先使用 Apple 验证出来的邮箱
        // 如果 Apple 没有返回，再使用 App 传过来的 email
        const userEmail = appleUser.email || email || null;

        console.log('最终使用的邮箱:', userEmail);

        // ==============================
        // 注册或者登录
        // ==============================

        // 目前还没有数据库
        // 暂时模拟一个 user_id

        const userId = 10001;

        console.log('系统用户 ID:', userId);

        // ==============================
        // 生成我们自己系统的 Token
        // ==============================

        const token = crypto.randomBytes(32).toString('hex');

        console.log('生成系统 Token:', token);

        // ==============================
        // 保存登录状态到 Redis
        // ==============================

        const sessionKey = `session:${token}`;

        await redisClient.set(
            sessionKey,
            JSON.stringify({
                user_id: userId,
                login_type: 'apple',
                apple_id: appleUserId,
                email: userEmail
            }),
            {
                EX: 30 * 24 * 60 * 60
            }
        );

        console.log('登录 Token 已保存到 Redis');
        console.log('Redis Key:', sessionKey);

        // ==============================
        // 注册完成后自动登录
        // ==============================

        return res.json({
            success: true,
            message: 'Apple 注册并登录成功',

            data: {
                user_id: userId,

                token: token,

                expires_in: 30 * 24 * 60 * 60,

                apple: {
                    id: appleUserId,
                    email: userEmail,
                    email_verified:
                        appleUser.email_verified || false
                }
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('Apple App 登录验证失败');
        console.error(error);
        console.error('==============================');

        return res.status(401).json({
            success: false,
            message: 'Apple App 登录失败',
            error: error.message
        });

    }

});


// 图片验证码生成接口
// ==============================
// 图片验证码生成接口
// ==============================

app.post('/api/account/captcha/image', async (req, res) => {

    console.log('==============================');
    console.log('图片验证码生成请求');
    console.log('==============================');

    try {

        const allowed = await checkIpRateLimit(
            req.ip,
            'captcha_image_generate',
            20
        );

        if (!allowed) {
            return res.status(429).json({
                success: false,
                message: '图片验证码请求过于频繁，请稍后再试'
            });
        }

        // 生成验证码
        const captcha = svgCaptcha.create({
            size: 4,
            ignoreChars: '0o1iIl',
            noise: 3,
            color: true,
            background: '#f2f2f2'
        });

        // 生成验证码 ID
        const captchaId = crypto
            .randomBytes(16)
            .toString('hex');

        // Redis Key
        const redisKey =
            `captcha_image:${captchaId}`;

        // 保存验证码答案
        await redisClient.set(
            redisKey,
            captcha.text.toUpperCase(),
            {
                EX: 5 * 60
            }
        );

        console.log('验证码 ID:', captchaId);
        console.log('验证码答案:', captcha.text);

        // SVG 转 Base64
        const imageBase64 = Buffer
            .from(captcha.data)
            .toString('base64');

        return res.json({

            success: true,

            message: '图片验证码生成成功',

            data: {

                captcha_id: captchaId,

                image: `data:image/svg+xml;base64,${imageBase64}`,

                expires_in: 5 * 60

            }

        });

    } catch (error) {

        console.error('图片验证码生成失败:', error);

        return res.status(500).json({

            success: false,

            message: '图片验证码生成失败'

        });

    }

});


// 图片验证码验证接口
// ==============================


app.post('/api/account/captcha/image/verify', async (req, res) => {

    console.log('==============================');
    console.log('图片验证码验证请求');
    console.log('==============================');

    try {

        const allowed = await checkIpRateLimit(
            req.ip,
            'captcha_image_verify',
            20
        );

        if (!allowed) {
            return res.status(429).json({
                success: false,
                message: '图片验证码验证过于频繁，请稍后再试'
            });
        }

        const {
            captcha_id,
            code
        } = req.body;

        // ==============================
        // 检查参数
        // ==============================

        if (!captcha_id) {

            return res.status(400).json({

                success: false,

                message: '缺少 captcha_id'

            });

        }

        if (!code) {

            return res.status(400).json({

                success: false,

                message: '请输入验证码'

            });

        }

        // ==============================
        // Redis Key
        // ==============================

        const redisKey =
            `captcha_image:${captcha_id}`;

        // ==============================
        // 获取验证码
        // ==============================

        const savedCode =
            await redisClient.get(redisKey);

        if (!savedCode) {

            return res.status(400).json({

                success: false,

                message: '验证码不存在或已过期'

            });

        }

        // ==============================
        // 验证
        // ==============================

        if (
            savedCode.toUpperCase() !==
            code.trim().toUpperCase()
        ) {

            return res.status(400).json({

                success: false,

                message: '验证码错误'

            });

        }

        console.log('图片验证码验证成功');

        // ==============================
        // 验证成功以后删除验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(redisKey);

        // ==============================
        // 生成 captcha_token
        // ==============================

        const captchaToken =
            crypto.randomBytes(32).toString('hex');

        const captchaTokenKey =
            `captcha_token:${captchaToken}`;

        // 保存验证结果
        await redisClient.set(

            captchaTokenKey,

            JSON.stringify({

                type: 'image',

                verified: true

            }),

            {
                EX: 5 * 60
            }

        );

        return res.json({

            success: true,

            message: '图片验证码验证成功',

            data: {

                captcha_token: captchaToken,

                expires_in: 5 * 60

            }

        });

    } catch (error) {

        console.error('图片验证码验证失败:', error);

        return res.status(500).json({

            success: false,

            message: '验证码验证失败'

        });

    }

});

// 滑动验证码生成接口
// ==============================


app.post('/api/account/captcha/slider', async (req, res) => {

    console.log('==============================');
    console.log('滑动验证码生成请求');
    console.log('==============================');

    try {

        const allowed = await checkIpRateLimit(
            req.ip,
            'captcha_slider_generate',
            20
        );

        if (!allowed) {
            return res.status(429).json({
                success: false,
                message: '滑动验证码请求过于频繁，请稍后再试'
            });
        }

        // ==============================
        // 图片尺寸
        // ==============================

        const width = 320;
        const height = 160;

        // ==============================
        // 随机生成缺口位置
        // ==============================

        const puzzleX =
            Math.floor(
                Math.random() * 160
            ) + 100;

        const puzzleY =
            Math.floor(
                Math.random() * 70
            ) + 30;

        const puzzleSize = 50;

        // ==============================
        // 生成随机背景颜色
        // ==============================

        const backgroundColors = [
            '#d9edf7',
            '#dff0d8',
            '#fcf8e3',
            '#f2dede',
            '#e8e8e8'
        ];

        const backgroundColor =
            backgroundColors[
                Math.floor(
                    Math.random() *
                    backgroundColors.length
                )
            ];

        // ==============================
        // 背景 SVG
        // ==============================

        const backgroundSvg = `
        <svg
            width="${width}"
            height="${height}"
            xmlns="http://www.w3.org/2000/svg"
        >

            <rect
                width="100%"
                height="100%"
                fill="${backgroundColor}"
            />

            <circle
                cx="60"
                cy="50"
                r="30"
                fill="#ffffff"
                opacity="0.5"
            />

            <circle
                cx="240"
                cy="120"
                r="45"
                fill="#ffffff"
                opacity="0.4"
            />

            <rect
                x="30"
                y="100"
                width="100"
                height="20"
                fill="#ffffff"
                opacity="0.3"
            />

            <circle
                cx="160"
                cy="40"
                r="20"
                fill="#ffffff"
                opacity="0.3"
            />

            <text
                x="160"
                y="85"
                text-anchor="middle"
                font-size="22"
                fill="#888888"
            >
                请拖动滑块完成验证
            </text>

        </svg>
        `;

        // ==============================
        // 生成缺口图 SVG
        // ==============================

        const puzzleSvg = `
        <svg
            width="${puzzleSize}"
            height="${puzzleSize}"
            xmlns="http://www.w3.org/2000/svg"
        >

            <rect
                width="${puzzleSize}"
                height="${puzzleSize}"
                rx="8"
                fill="#ffffff"
                stroke="#555555"
                stroke-width="2"
            />

            <circle
                cx="25"
                cy="25"
                r="8"
                fill="#dddddd"
            />

        </svg>
        `;

        // ==============================
        // 转 Base64
        // ==============================

        const backgroundBuffer =
            await sharp(
                Buffer.from(backgroundSvg)
            )
            .png()
            .toBuffer();

        const puzzleBuffer =
            await sharp(
                Buffer.from(puzzleSvg)
            )
            .png()
            .toBuffer();

        // ==============================
        // 生成 captcha_id
        // ==============================

        const captchaId =
            crypto.randomBytes(16).toString('hex');

        // ==============================
        // 保存正确位置到 Redis
        // ==============================

        const redisKey =
            `captcha_slider:${captchaId}`;

        await redisClient.set(

            redisKey,

            JSON.stringify({

                x: puzzleX,

                y: puzzleY,

                size: puzzleSize

            }),

            {
                EX: 5 * 60
            }

        );

        console.log('滑动验证码 ID:', captchaId);
        console.log('正确 X:', puzzleX);
        console.log('正确 Y:', puzzleY);

        // ==============================
        // 返回
        // ==============================

        return res.json({

            success: true,

            message: '滑动验证码生成成功',

            data: {

                captcha_id: captchaId,

                background:
                    `data:image/png;base64,${backgroundBuffer.toString('base64')}`,

                puzzle:
                    `data:image/png;base64,${puzzleBuffer.toString('base64')}`,

                width: width,

                height: height,

                puzzle_size: puzzleSize,

                expires_in: 5 * 60

            }

        });

    } catch (error) {

        console.error('滑动验证码生成失败:', error);

        return res.status(500).json({

            success: false,

            message: '滑动验证码生成失败'

        });

    }

});

// 滑动验证码验证接口
// ==============================


app.post('/api/account/captcha/slider/verify', async (req, res) => {

    console.log('==============================');
    console.log('滑动验证码验证请求');
    console.log('==============================');

    try {

        const allowed = await checkIpRateLimit(
            req.ip,
            'captcha_slider_verify',
            20
        );

        if (!allowed) {
            return res.status(429).json({
                success: false,
                message: '滑动验证码验证过于频繁，请稍后再试'
            });
        }

        const {
            captcha_id,
            x
        } = req.body;

        // ==============================
        // 检查参数
        // ==============================

        if (!captcha_id) {

            return res.status(400).json({

                success: false,

                message: '缺少 captcha_id'

            });

        }

        if (
            x === undefined ||
            x === null
        ) {

            return res.status(400).json({

                success: false,

                message: '缺少滑动位置'

            });

        }

        // ==============================
        // Redis Key
        // ==============================

        const redisKey =
            `captcha_slider:${captcha_id}`;

        // ==============================
        // 获取正确位置
        // ==============================

        const savedData =
            await redisClient.get(redisKey);

        if (!savedData) {

            return res.status(400).json({

                success: false,

                message: '验证码不存在或已过期'

            });

        }

        const puzzleData =
            JSON.parse(savedData);

        // ==============================
        // 用户滑动位置
        // ==============================

        const userX =
            Number(x);

        const correctX =
            Number(puzzleData.x);

        // ==============================
        // 允许误差
        // ==============================

        const tolerance = 5;

        const difference =
            Math.abs(
                userX - correctX
            );

        console.log('用户 X:', userX);
        console.log('正确 X:', correctX);
        console.log('误差:', difference);

        // ==============================
        // 验证失败
        // ==============================

        if (difference > tolerance) {

            return res.status(400).json({

                success: false,

                message: '滑动位置错误'

            });

        }

        console.log('滑动验证码验证成功');

        // ==============================
        // 删除验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(redisKey);

        // ==============================
        // 生成 captcha_token
        // ==============================

        const captchaToken =
            crypto.randomBytes(32).toString('hex');

        const captchaTokenKey =
            `captcha_token:${captchaToken}`;

        await redisClient.set(

            captchaTokenKey,

            JSON.stringify({

                type: 'slider',

                verified: true

            }),

            {
                EX: 5 * 60
            }

        );

        // ==============================
        // 返回
        // ==============================

        return res.json({

            success: true,

            message: '滑动验证码验证成功',

            data: {

                captcha_token: captchaToken,

                expires_in: 5 * 60

            }

        });

    } catch (error) {

        console.error('滑动验证码验证失败:', error);

        return res.status(500).json({

            success: false,

            message: '滑动验证码验证失败'

        });

    }

});






//邮箱注册
// 需要发送邮箱验证码
// ==============================

// 发送邮箱验证码
async function sendEmailCode(email, code) {
    console.log('收件邮箱:', email);
    console.log('验证码:', code);
    // 这里以后实现真正的邮件发送
}

// 发送邮箱注册验证码
app.post('/api/account/email/send-code', async (req, res) => {

    console.log('==============================');
    console.log('发送邮箱注册验证码');
    console.log('==============================');
        

    try {
        // ==============================
        // IP 限制
        // 同一个 IP 1 分钟最多 2 次邮箱发送
        // ==============================

        const allowed = await checkIpRateLimit(
            req.ip,
            'email',
            2
        );

        if (!allowed) {
            return res.status(429).json({
                success: false,
                message: '操作过于频繁，请稍后再试'
            });
        }



        

        const {
            email,
            captcha_token
        } = req.body;

        // ==============================
        // 1. 检查邮箱
        // ==============================

        if (!email) {
            return res.status(400).json({
                success: false,
                message: '请输入邮箱'
            });
        }

        // ==============================
        // 2. 检查 captcha_token
        // ==============================

        if (!captcha_token) {
            return res.status(400).json({
                success: false,
                message: '请先完成验证码验证'
            });
        }

        // ==============================
        // 3. 验证 captcha_token
        // ==============================

        const captchaTokenKey =
            `captcha_token:${captcha_token}`;

        const captchaData =
            await redisClient.get(captchaTokenKey);

        if (!captchaData) {
            return res.status(400).json({
                success: false,
                message: '验证码验证已过期，请重新验证'
            });
        }

        console.log('captcha_token 验证成功');

        // ==============================
        // 4. 使用一次后立即删除
        // ==============================

        await redisClient.del(captchaTokenKey);

        // ==============================
        // 5. 统一邮箱格式
        // ==============================

        const normalizedEmail =
            email.trim().toLowerCase();

        console.log('用户邮箱:', normalizedEmail);

        // ==============================
        // 6. 生成 6 位验证码
        // ==============================

        const code = Math.floor(
            100000 + Math.random() * 900000
        ).toString();

        console.log('生成验证码:', code);

        // ==============================
        // 7. Redis Key
        // ==============================

        const redisKey =
            `email_register_code:${normalizedEmail}`;

        // ==============================
        // 8. 保存验证码
        // 5 分钟过期
        // ==============================

        await redisClient.set(
            redisKey,
            code,
            {
                EX: 5 * 60
            }
        );

        console.log('验证码已经保存到 Redis');
        console.log('Redis Key:', redisKey);

        // ==============================
        // 9. 发送邮件
        // ==============================

        await sendEmailCode(
            normalizedEmail,
            code
        );

        // ==============================
        // 10. 返回结果
        // ==============================

        return res.json({
            success: true,
            message: '验证码发送成功',
            data: {
                expires_in: 5 * 60
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('发送邮箱验证码失败');
        console.error(error);
        console.error('==============================');

        return res.status(500).json({
            success: false,
            message: '发送验证码失败'
        });

    }

});

//注册账号
// ==============================
// 邮箱注册
// ==============================

app.post('/api/account/email/register', async (req, res) => {

    console.log('==============================');
    console.log('邮箱注册请求');
    console.log('==============================');

    try {

        const {
            email,
            code,
            password
        } = req.body;

        // ==============================
        // 1. 检查参数
        // ==============================

        if (!email) {

            return res.status(400).json({
                success: false,
                message: '请输入邮箱'
            });

        }

        if (!code) {

            return res.status(400).json({
                success: false,
                message: '请输入邮箱验证码'
            });

        }

        if (!password) {

            return res.status(400).json({
                success: false,
                message: '请输入密码'
            });

        }

        // ==============================
        // 2. 统一邮箱格式
        // ==============================

        const normalizedEmail = email
            .trim()
            .toLowerCase();

        // ==============================
        // 3. Redis Key
        // ==============================

        const redisKey =
            `email_register_code:${normalizedEmail}`;

        // ==============================
        // 4. 从 Redis 获取验证码
        // ==============================

        const savedCode = await redisClient.get(
            redisKey
        );

        console.log('Redis 中的验证码:', savedCode);
        console.log('用户提交的验证码:', code);

        // ==============================
        // 5. 验证码不存在
        // ==============================

        if (!savedCode) {

            return res.status(400).json({
                success: false,
                message: '验证码不存在或已过期'
            });

        }

        // ==============================
        // 6. 验证验证码
        // ==============================

        if (savedCode !== code.trim()) {

            return res.status(400).json({
                success: false,
                message: '验证码错误'
            });

        }

        console.log('验证码验证成功');

        // ==============================
        // 7. 注册用户
        // ==============================

        console.log('==============================');
        console.log('用户注册信息');
        console.log('==============================');

        console.log('邮箱:', normalizedEmail);
        console.log('密码:', password);
        console.log('验证码:', code);

        console.log('==============================');

        // ==============================
        // 暂时没有数据库
        // 这里先模拟 user_id
        // ==============================

        const userId = 10001;

        console.log('系统用户 ID:', userId);

        // ==============================
        // 8. 生成我们自己系统的 Token
        // ==============================

        const token = crypto.randomBytes(32).toString('hex');

        console.log('生成系统 Token:', token);

        // ==============================
        // 9. 保存登录状态到 Redis
        // ==============================

        const sessionKey = `session:${token}`;

        await redisClient.set(
            sessionKey,
            JSON.stringify({
                user_id: userId,
                login_type: 'email',
                email: normalizedEmail
            }),
            {
                EX: 30 * 24 * 60 * 60
            }
        );

        console.log('登录 Token 已保存到 Redis');
        console.log('Redis Key:', sessionKey);

        // ==============================
        // 10. 删除注册验证码
        // 防止验证码重复使用
        // ==============================

        await redisClient.del(redisKey);

        console.log('Redis 验证码已经删除');

        // ==============================
        // 11. 注册完成，自动登录
        // ==============================

        return res.json({
            success: true,
            message: '注册成功并已登录',

            data: {
                user_id: userId,
                email: normalizedEmail,
                token: token,
                expires_in: 30 * 24 * 60 * 60
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('邮箱注册失败');
        console.error(error);
        console.error('==============================');

        return res.status(500).json({
            success: false,
            message: '注册失败'
        });

    }

});


  
//手机发送短信
async function sendSms(phone, message) {

    console.log('==============================');
    console.log('准备发送短信');
    console.log('手机号:', phone);
    console.log('短信内容:', message);
    console.log('==============================');

    // TODO:
    // 这里以后接入 Twilio、AWS SNS、阿里云等短信服务
    // 例如：
    // await xxx.send(phone, message);

    return true;
}


// ==============================
// 发送注册短信验证码
// ==============================
app.post('/api/account/phone/send-code', async (req, res) => {

    console.log('==============================');
    console.log('发送注册短信验证码');
    console.log('==============================');

    try {

        const allowed = await checkIpRateLimit(
            req.ip,
            'phone_sms',
            1
        );

        if (!allowed) {
            return res.status(429).json({
                success: false,
                message: '短信发送过于频繁，请稍后再试'
            });
        }



        const {
            phone,
            captcha_token
        } = req.body;

        // 1. 检查手机号
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: '请输入手机号'
            });
        }

        // 2. 检查验证码 Token
        if (!captcha_token) {
            return res.status(400).json({
                success: false,
                message: '请先完成验证码验证'
            });
        }

        // 3. 验证 captcha_token
        const captchaTokenKey =
            `captcha_token:${captcha_token}`;

        const captchaData =
            await redisClient.get(captchaTokenKey);

        if (!captchaData) {
            return res.status(400).json({
                success: false,
                message: '验证码验证已过期，请重新验证'
            });
        }

        // 4. 验证成功后立即删除
        await redisClient.del(captchaTokenKey);

        console.log('captcha_token 验证成功');

        // 5. 处理手机号
        const normalizedPhone = phone.trim();

        console.log('手机号:', normalizedPhone);

        // 6. 生成 6 位验证码
        const code =
            Math.floor(
                100000 +
                Math.random() * 900000
            ).toString();

        console.log('生成短信验证码:', code);

        // 7. 保存验证码到 Redis
        const redisKey =
            `phone_register_code:${normalizedPhone}`;

        await redisClient.set(
            redisKey,
            code,
            {
                EX: 5 * 60
            }
        );

        console.log('短信验证码已经保存到 Redis');
        console.log('Redis Key:', redisKey);

        // 8. 生成短信内容
        const message =
            `您的注册验证码是：${code}，5分钟内有效。`;

        // 9. 发送短信
        await sendSms(
            normalizedPhone,
            message
        );

        console.log('短信发送函数执行完成');

        // 10. 返回结果
        return res.json({
            success: true,
            message: '短信验证码发送成功',
            data: {
                expires_in: 5 * 60
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('发送短信验证码失败');
        console.error(error);
        console.error('==============================');

        return res.status(500).json({
            success: false,
            message: '发送短信验证码失败'
        });
    }
});
// ==============================
// 手机号注册
// 注册成功后直接登录
// ==============================

app.post('/api/account/phone/register', async (req, res) => {

    console.log('==============================');
    console.log('手机号注册请求');
    console.log('==============================');

    try {

        const {
            phone,
            code,
            password
        } = req.body;

        // ==============================
        // 1. 检查手机号
        // ==============================

        if (!phone) {

            return res.status(400).json({
                success: false,
                message: '请输入手机号'
            });

        }

        // ==============================
        // 2. 检查验证码
        // ==============================

        if (!code) {

            return res.status(400).json({
                success: false,
                message: '请输入短信验证码'
            });

        }

        // ==============================
        // 3. 检查密码
        // ==============================

        if (!password) {

            return res.status(400).json({
                success: false,
                message: '请输入密码'
            });

        }

        // ==============================
        // 4. 手机号
        // ==============================

        const normalizedPhone =
            phone.trim();

        console.log(
            '手机号:',
            normalizedPhone
        );

        // ==============================
        // 5. 查询 Redis 验证码
        // ==============================

        const redisKey =
            `phone_register_code:${normalizedPhone}`;

        const savedCode =
            await redisClient.get(redisKey);

        console.log(
            'Redis 验证码:',
            savedCode
        );

        console.log(
            '用户提交验证码:',
            code
        );

        // ==============================
        // 6. 验证码不存在
        // ==============================

        if (!savedCode) {

            return res.status(400).json({
                success: false,
                message: '验证码不存在或已过期'
            });

        }

        // ==============================
        // 7. 验证码错误
        // ==============================

        if (savedCode !== code.trim()) {

            return res.status(400).json({
                success: false,
                message: '验证码错误'
            });

        }

        console.log('验证码验证成功');

        // ==============================
        // 8. 创建用户
        // ==============================
        //
        // 目前没有数据库
        // 暂时模拟 user_id
        // ==============================

    

        console.log(
            '创建用户:',
            userId
        );

        // ==============================
        // 9. 生成 Token
        // ==============================

        const token =
            crypto.randomBytes(32).toString('hex');

        console.log(
            '生成 Token:',
            token
        );

        // ==============================
        // 10. 保存 Token 到 Redis
        // ==============================

        const sessionKey =
            `session:${token}`;

        await redisClient.set(
            sessionKey,
            JSON.stringify({
                user_id: userId,
                account: normalizedPhone,
                account_type: 'phone'
            }),
            {
                EX: 30 * 24 * 60 * 60
            }
        );

        console.log(
            'Token 已保存到 Redis'
        );

        // ==============================
        // 11. 删除注册验证码
        // ==============================

        await redisClient.del(redisKey);

        console.log(
            '注册验证码已经删除'
        );

        // ==============================
        // 12. 返回注册 + 登录成功
        // ==============================

        return res.json({
            success: true,
            message: '注册成功并已登录',
            data: {
                user_id: userId,
                phone: normalizedPhone,
                token: token,
                expires_in: 30 * 24 * 60 * 60
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('手机号注册失败');
        console.error(error);
        console.error('==============================');

        return res.status(500).json({
            success: false,
            message: '注册失败'
        });

    }

});

//需要发送短信验证码




//防攻击验证码生成接口





// ==============================
// 邮箱 / 手机号+ 密码登录
// ==============================



app.post('/api/account/login/password', async (req, res) => {

    console.log('==============================');
    console.log('账号密码登录');
    console.log('==============================');

    try {

        const {
            account,
            password,
            captcha_id,
            x,
            platform
        } = req.body;

        // ==============================
        // 1. 检查账号
        // ==============================

        if (!account) {

            return res.status(400).json({
                success: false,
                message: '请输入邮箱或手机号'
            });

        }

        // ==============================
        // 2. 检查密码
        // ==============================

        if (!password) {

            return res.status(400).json({
                success: false,
                message: '请输入密码'
            });

        }

        // ==============================
        // 3. 检查 captcha_id
        // ==============================

        if (!captcha_id) {

            return res.status(400).json({
                success: false,
                message: '缺少 captcha_id'
            });

        }

        // ==============================
        // 4. 检查滑动位置
        // ==============================

        if (
            x === undefined ||
            x === null
        ) {

            return res.status(400).json({
                success: false,
                message: '缺少滑动位置'
            });

        }

        // ==============================
        // 5. 检查平台
        // ==============================

        if (
            platform !== 'web' &&
            platform !== 'app'
        ) {

            return res.status(400).json({
                success: false,
                message: 'platform 必须是 web 或 app'
            });

        }

        // ==============================
        // 6. 验证滑动验证码
        // ==============================

        const captchaRedisKey =
            `captcha_slider:${captcha_id}`;

        const savedData =
            await redisClient.get(captchaRedisKey);

        if (!savedData) {

            return res.status(400).json({
                success: false,
                message: '验证码不存在或已过期'
            });

        }

        // ==============================
        // 7. 获取正确位置
        // ==============================

        const puzzleData =
            JSON.parse(savedData);

        // ==============================
        // 8. 用户滑动位置
        // ==============================

        const userX =
            Number(x);

        const correctX =
            Number(puzzleData.x);

        // ==============================
        // 9. 允许误差
        // ==============================

        const tolerance = 5;

        const difference =
            Math.abs(
                userX - correctX
            );

        console.log(
            '用户 X:',
            userX
        );

        console.log(
            '正确 X:',
            correctX
        );

        console.log(
            '误差:',
            difference
        );

        // ==============================
        // 10. 滑动验证码验证失败
        // ==============================

        if (difference > tolerance) {

            return res.status(400).json({
                success: false,
                message: '滑动位置错误'
            });

        }

        console.log(
            '滑动验证码验证成功'
        );

        // ==============================
        // 11. 删除滑动验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(
            captchaRedisKey
        );

        // ==============================
        // 12. 统一账号格式
        // ==============================

        const normalizedAccount =
            account.trim().toLowerCase();

        console.log(
            '登录账号:',
            normalizedAccount
        );

        console.log(
            '登录平台:',
            platform
        );

        // ==============================
        // 13. 判断账号类型
        // ==============================

        let accountType;

        if (
            normalizedAccount.includes('@')
        ) {

            accountType = 'email';

        } else {

            accountType = 'phone';

        }

        console.log(
            '账号类型:',
            accountType
        );

        // ==============================
        // 14. 暂时模拟用户 ID
        // ==============================

        // TODO：
        // 以后接数据库后，
        // 根据邮箱 / 手机号查询真正的 user_id

        const userId = 10001;

        console.log(
            '用户 ID:',
            userId
        );

        // ==============================
        // 15. TODO：数据库验证密码
        // ==============================

        // 以后这里：
        //
        // 1. 根据 accountType 查询用户
        // 2. 查询密码 Hash
        // 3. 使用 bcrypt / argon2 验证 password
        //
        // 目前暂时跳过

        console.log(
            '暂时跳过数据库密码验证'
        );

        // ==============================
        // 16. 生成统一 Token
        // ==============================

        const token =
            crypto.randomBytes(32).toString('hex');

        console.log(
            '生成 Token:',
            token
        );

        // ==============================
        // 17. Redis Session Key
        // ==============================

        const sessionKey =
            `session:${token}`;

        // ==============================
        // 18. Token 有效期
        // 30 天
        // ==============================

        const expiresIn =
            30 * 24 * 60 * 60;

        // ==============================
        // 19. 保存 Session
        // ==============================

        await redisClient.set(
            sessionKey,
            JSON.stringify({
                user_id: userId,
                account: normalizedAccount,
                account_type: accountType,
                login_type: 'password',
                platform: platform
            }),
            {
                EX: expiresIn
            }
        );

        console.log(
            'Session 已保存到 Redis'
        );

        console.log(
            'Redis Key:',
            sessionKey
        );

        // ==============================
        // 20. Web 登录
        // ==============================

        if (platform === 'web') {

            res.cookie(
                'token',
                token,
                {
                    httpOnly: true,

                    // 本地 HTTP 测试
                    // 正式 HTTPS 改成 true
                    secure: false,

                    sameSite: 'lax',

                    // 30 天
                    maxAge:
                        expiresIn * 1000
                }
            );

            console.log(
                'Web Cookie 已设置'
            );

            return res.json({
                success: true,
                message: '登录成功',
                data: {
                    user_id: userId,
                    account: normalizedAccount,
                    account_type: accountType,
                    expires_in: expiresIn
                }
            });

        }

        // ==============================
        // 21. App 登录
        // ==============================

        if (platform === 'app') {

            console.log(
                'App Token 登录成功'
            );

            return res.json({
                success: true,
                message: '登录成功',
                data: {
                    user_id: userId,
                    account: normalizedAccount,
                    account_type: accountType,
                    token: token,
                    expires_in: expiresIn
                }
            });

        }

    } catch (error) {

        console.error('==============================');
        console.error('账号密码登录失败');
        console.error(error);
        console.error('==============================');

        return res.status(500).json({
            success: false,
            message: '登录失败'
        });

    }

});


// ==============================
// 发送邮箱登录验证码
// ==============================
app.post('/api/account/email/login/send-code', async (req, res) => {

    console.log('==============================');
    console.log('发送邮箱登录验证码');
    console.log('==============================');

    try {

        const allowed = await checkIpRateLimit(
            req.ip,
            'email',
            2
        );

        if (!allowed) {
            return res.status(429).json({
                success: false,
                message: '操作过于频繁，请稍后再试'
            });
        }

        const {
            email,
            captcha_token
        } = req.body;

        // ==============================
        // 1. 检查邮箱
        // ==============================

        if (!email) {
            return res.status(400).json({
                success: false,
                message: '请输入邮箱'
            });
        }

        // ==============================
        // 2. 检查 captcha_token
        // ==============================

        if (!captcha_token) {
            return res.status(400).json({
                success: false,
                message: '请先完成验证码验证'
            });
        }

        // ==============================
        // 3. 验证 captcha_token
        // ==============================

        const captchaTokenKey =
            `captcha_token:${captcha_token}`;

        const captchaData =
            await redisClient.get(captchaTokenKey);

        if (!captchaData) {
            return res.status(400).json({
                success: false,
                message: '验证码验证已过期，请重新验证'
            });
        }

        console.log('captcha_token 验证成功');

        // ==============================
        // 4. captcha_token 使用一次后删除
        // ==============================

        await redisClient.del(captchaTokenKey);

        // ==============================
        // 5. 统一邮箱格式
        // ==============================

        const normalizedEmail =
            email.trim().toLowerCase();

        console.log('用户邮箱:', normalizedEmail);

        // ==============================
        // 6. 生成 6 位登录验证码
        // ==============================

        const code = Math.floor(
            100000 + Math.random() * 900000
        ).toString();

        console.log('生成登录验证码:', code);

        // ==============================
        // 7. Redis Key
        // ==============================

        const redisKey =
            `email_login_code:${normalizedEmail}`;

        // ==============================
        // 8. 保存验证码
        // 5 分钟过期
        // ==============================

        await redisClient.set(
            redisKey,
            code,
            {
                EX: 5 * 60
            }
        );

        console.log('登录验证码已经保存到 Redis');
        console.log('Redis Key:', redisKey);

        // ==============================
        // 9. 发送邮件
        // ==============================

        await sendEmailCode(
            normalizedEmail,
            code
        );

        // ==============================
        // 10. 返回结果
        // ==============================

        return res.json({
            success: true,
            message: '登录验证码发送成功',
            data: {
                expires_in: 5 * 60
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('发送邮箱登录验证码失败');
        console.error(error);
        console.error('==============================');

        return res.status(500).json({
            success: false,
            message: '发送登录验证码失败'
        });

    }

});
// 邮箱 + 邮箱验证码登录
// ==============================
// ==============================
// 邮箱验证码登录
// ==============================

app.post('/api/account/login/email/code', async (req, res) => {

    console.log('==============================');
    console.log('邮箱验证码登录');
    console.log('==============================');

    try {

        const {
            email,
            code,
            captcha_id,
            x,
            platform
        } = req.body;


        // ==============================
        // 1. 检查平台
        // ==============================

        if (
            platform !== 'web' &&
            platform !== 'app'
        ) {

            return res.status(400).json({
                success: false,
                message: 'platform 必须是 web 或 app'
            });

        }


        // ==============================
        // 2. 检查邮箱
        // ==============================

        if (!email) {

            return res.status(400).json({
                success: false,
                message: '请输入邮箱'
            });

        }


        // ==============================
        // 3. 检查邮箱验证码
        // ==============================

        if (!code) {

            return res.status(400).json({
                success: false,
                message: '请输入邮箱验证码'
            });

        }


        // ==============================
        // 4. 检查 captcha_id
        // ==============================

        if (!captcha_id) {

            return res.status(400).json({
                success: false,
                message: '缺少 captcha_id'
            });

        }


        // ==============================
        // 5. 检查滑动位置
        // ==============================

        if (
            x === undefined ||
            x === null
        ) {

            return res.status(400).json({
                success: false,
                message: '缺少滑动位置'
            });

        }


        // ==============================
        // 6. Redis Key
        // ==============================

        const captchaRedisKey =
            `captcha_slider:${captcha_id}`;


        // ==============================
        // 7. 获取滑块验证码数据
        // ==============================

        const savedData =
            await redisClient.get(
                captchaRedisKey
            );


        // ==============================
        // 8. 验证码不存在或过期
        // ==============================

        if (!savedData) {

            return res.status(400).json({
                success: false,
                message: '验证码不存在或已过期'
            });

        }


        // ==============================
        // 9. 解析滑块数据
        // ==============================

        const puzzleData =
            JSON.parse(savedData);


        // ==============================
        // 10. 用户滑动位置
        // ==============================

        const userX =
            Number(x);


        // ==============================
        // 11. 正确滑动位置
        // ==============================

        const correctX =
            Number(puzzleData.x);


        // ==============================
        // 12. 允许误差
        // ==============================

        const tolerance = 5;


        // ==============================
        // 13. 计算误差
        // ==============================

        const difference =
            Math.abs(
                userX - correctX
            );


        console.log(
            '用户 X:',
            userX
        );

        console.log(
            '正确 X:',
            correctX
        );

        console.log(
            '误差:',
            difference
        );


        // ==============================
        // 14. 滑块验证失败
        // ==============================

        if (
            difference > tolerance
        ) {

            return res.status(400).json({
                success: false,
                message: '滑动位置错误'
            });

        }


        console.log(
            '滑动验证码验证成功'
        );


        // ==============================
        // 15. 删除滑块验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(
            captchaRedisKey
        );


        console.log(
            '滑块验证码已使用并删除'
        );


        // ==============================
        // 16. 统一邮箱
        // ==============================

        const normalizedEmail =
            email.trim().toLowerCase();


        console.log(
            '登录邮箱:',
            normalizedEmail
        );


        // ==============================
        // 17. Redis Key
        // ==============================

        const redisKey =
            `email_login_code:${normalizedEmail}`;


        // ==============================
        // 18. 获取邮箱验证码
        // ==============================

        const savedCode =
            await redisClient.get(
                redisKey
            );


        console.log(
            'Redis 验证码:',
            savedCode
        );

        console.log(
            '用户验证码:',
            code
        );


        // ==============================
        // 19. 验证码不存在
        // ==============================

        if (!savedCode) {

            return res.status(400).json({
                success: false,
                message: '验证码不存在或已过期'
            });

        }


        // ==============================
        // 20. 验证邮箱验证码
        // ==============================

        if (
            savedCode !== code.trim()
        ) {

            return res.status(400).json({
                success: false,
                message: '验证码错误'
            });

        }


        console.log(
            '邮箱验证码验证成功'
        );


        // ==============================
        // 21. 删除邮箱验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(
            redisKey
        );


        console.log(
            '邮箱验证码已使用并删除'
        );


        // ==============================
        // 22. 暂时模拟用户 ID
        // ==============================

        // TODO：
        // 以后数据库根据邮箱查询真正的 user_id

        const userId = 10001;


        console.log(
            '用户 ID:',
            userId
        );


        // ==============================
        // 23. 生成统一 Token
        // ==============================

        const token =
            crypto.randomBytes(32).toString('hex');


        console.log(
            '生成 Token:',
            token
        );


        // ==============================
        // 24. Redis Session Key
        // ==============================

        const sessionKey =
            `session:${token}`;


        // ==============================
        // 25. Token 有效期
        // 30 天
        // ==============================

        const expiresIn =
            30 * 24 * 60 * 60;


        // ==============================
        // 26. 保存 Session
        // ==============================

        await redisClient.set(
            sessionKey,

            JSON.stringify({

                user_id: userId,

                email: normalizedEmail,

                login_type: 'email_code',

                platform: platform

            }),

            {
                EX: expiresIn
            }
        );


        console.log(
            'Session 已保存到 Redis'
        );

        console.log(
            'Redis Key:',
            sessionKey
        );


        // ==============================
        // 27. Web 登录
        // ==============================

        if (platform === 'web') {

            res.cookie(
                'token',
                token,
                {

                    httpOnly: true,

                    // 本地 HTTP 测试
                    // 正式 HTTPS 改成 true
                    secure: false,

                    sameSite: 'lax',

                    maxAge:
                        expiresIn * 1000

                }
            );


            console.log(
                'Web Cookie 已设置'
            );


            return res.json({

                success: true,

                message: '登录成功',

                data: {

                    user_id: userId,

                    email: normalizedEmail,

                    expires_in: expiresIn

                }

            });

        }


        // ==============================
        // 28. App 登录
        // ==============================

        if (platform === 'app') {

            console.log(
                'App Token 登录成功'
            );


            return res.json({

                success: true,

                message: '登录成功',

                data: {

                    user_id: userId,

                    email: normalizedEmail,

                    token: token,

                    expires_in: expiresIn

                }

            });

        }


    } catch (error) {

        console.error(
            '=============================='
        );

        console.error(
            '邮箱验证码登录失败'
        );

        console.error(
            error
        );

        console.error(
            '=============================='
        );


        return res.status(500).json({

            success: false,

            message: '登录失败'

        });

    }

});



// 发送登录手机号验证码接口  
app.post('/api/account/phone/login/send-code', async (req, res) => {


    console.log('==============================');
    console.log('发送手机号登录验证码');
    console.log('==============================');

    try {

        const allowed = await checkIpRateLimit(
            req.ip,
            'phone_sms',
            1
        );

        if (!allowed) {
            return res.status(429).json({
                success: false,
                message: '短信发送过于频繁，请稍后再试'
            });
        }

        const {
            phone,
            captcha_token
        } = req.body;

        // ==============================
        // 1. 检查手机号
        // ==============================

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: '请输入手机号'
            });
        }

        // ==============================
        // 2. 检查 captcha_token
        // ==============================

        if (!captcha_token) {
            return res.status(400).json({
                success: false,
                message: '请先完成验证码验证'
            });
        }

        // ==============================
        // 3. 验证 captcha_token
        // ==============================

        const captchaTokenKey =
            `captcha_token:${captcha_token}`;

        const captchaData =
            await redisClient.get(captchaTokenKey);

        if (!captchaData) {
            return res.status(400).json({
                success: false,
                message: '验证码验证已过期，请重新验证'
            });
        }

        console.log('captcha_token 验证成功');

        // ==============================
        // 4. captcha_token 使用一次后删除
        // ==============================

        await redisClient.del(captchaTokenKey);

        // ==============================
        // 5. 统一手机号格式
        // ==============================

        const normalizedPhone =
            phone.trim();

        console.log('用户手机号:', normalizedPhone);

        // ==============================
        // 6. 生成 6 位登录验证码
        // ==============================

        const code = Math.floor(
            100000 + Math.random() * 900000
        ).toString();

        console.log('生成登录验证码:', code);

        // ==============================
        // 7. Redis Key
        // ==============================

        const redisKey =
            `phone_login_code:${normalizedPhone}`;

        // ==============================
        // 8. 保存验证码
        // 5 分钟过期
        // ==============================

        await redisClient.set(
            redisKey,
            code,
            {
                EX: 5 * 60
            }
        );

        console.log('登录验证码已经保存到 Redis');
        console.log('Redis Key:', redisKey);

        // ==============================
        // 9. 短信内容
        // ==============================

        const message =
            `您的登录验证码是：${code}，5分钟内有效。`;

        // ==============================
        // 10. 发送短信
        // ==============================

        await sendSms(
            normalizedPhone,
            message
        );

        console.log('短信发送函数执行完成');

        // ==============================
        // 11. 返回结果
        // ==============================

        return res.json({
            success: true,
            message: '登录验证码发送成功',
            data: {
                expires_in: 5 * 60
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('发送手机号登录验证码失败');
        console.error(error);
        console.error('==============================');

        return res.status(500).json({
            success: false,
            message: '发送登录验证码失败'
        });

    }

});





// ==============================
// 手机号 + 手机验证码登录
// ==============================

// ==============================
// 手机号验证码登录
// ==============================

app.post('/api/account/login/phone/code', async (req, res) => {

    console.log('==============================');
    console.log('手机号验证码登录');
    console.log('==============================');

    try {

        const {
            phone,
            code,
            captcha_id,
            x,
            platform
        } = req.body;


        // ==============================
        // 1. 检查平台
        // ==============================

        if (
            platform !== 'web' &&
            platform !== 'app'
        ) {

            return res.status(400).json({
                success: false,
                message: 'platform 必须是 web 或 app'
            });

        }


        // ==============================
        // 2. 检查手机号
        // ==============================

        if (!phone) {

            return res.status(400).json({
                success: false,
                message: '请输入手机号'
            });

        }


        // ==============================
        // 3. 检查手机验证码
        // ==============================

        if (!code) {

            return res.status(400).json({
                success: false,
                message: '请输入手机验证码'
            });

        }


        // ==============================
        // 4. 检查 captcha_id
        // ==============================

        if (!captcha_id) {

            return res.status(400).json({
                success: false,
                message: '缺少 captcha_id'
            });

        }


        // ==============================
        // 5. 检查滑动位置
        // ==============================

        if (
            x === undefined ||
            x === null
        ) {

            return res.status(400).json({
                success: false,
                message: '缺少滑动位置'
            });

        }


        // ==============================
        // 6. Redis Key
        // ==============================

        const captchaRedisKey =
            `captcha_slider:${captcha_id}`;


        // ==============================
        // 7. 获取滑块验证码数据
        // ==============================

        const savedData =
            await redisClient.get(
                captchaRedisKey
            );


        // ==============================
        // 8. 验证码不存在或已过期
        // ==============================

        if (!savedData) {

            return res.status(400).json({
                success: false,
                message: '验证码不存在或已过期'
            });

        }


        // ==============================
        // 9. 解析滑块数据
        // ==============================

        const puzzleData =
            JSON.parse(savedData);


        // ==============================
        // 10. 用户滑动位置
        // ==============================

        const userX =
            Number(x);


        // ==============================
        // 11. 正确滑动位置
        // ==============================

        const correctX =
            Number(puzzleData.x);


        // ==============================
        // 12. 允许误差
        // ==============================

        const tolerance = 5;


        // ==============================
        // 13. 计算误差
        // ==============================

        const difference =
            Math.abs(
                userX - correctX
            );


        console.log(
            '用户 X:',
            userX
        );

        console.log(
            '正确 X:',
            correctX
        );

        console.log(
            '误差:',
            difference
        );


        // ==============================
        // 14. 滑块验证失败
        // ==============================

        if (
            difference > tolerance
        ) {

            return res.status(400).json({
                success: false,
                message: '滑动位置错误'
            });

        }


        console.log(
            '滑动验证码验证成功'
        );


        // ==============================
        // 15. 删除滑块验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(
            captchaRedisKey
        );


        console.log(
            '滑块验证码已使用并删除'
        );


        // ==============================
        // 16. 统一手机号格式
        // ==============================

        const normalizedPhone =
            phone.trim();


        console.log(
            '手机号:',
            normalizedPhone
        );


        // ==============================
        // 17. Redis Key
        // ==============================

        const redisKey =
            `phone_login_code:${normalizedPhone}`;


        // ==============================
        // 18. 获取手机验证码
        // ==============================

        const savedCode =
            await redisClient.get(
                redisKey
            );


        console.log(
            'Redis 验证码:',
            savedCode
        );

        console.log(
            '用户验证码:',
            code
        );


        // ==============================
        // 19. 验证码不存在
        // ==============================

        if (!savedCode) {

            return res.status(400).json({
                success: false,
                message: '验证码不存在或已过期'
            });

        }


        // ==============================
        // 20. 验证手机验证码
        // ==============================

        if (
            savedCode !== code.trim()
        ) {

            return res.status(400).json({
                success: false,
                message: '验证码错误'
            });

        }


        console.log(
            '手机验证码验证成功'
        );


        // ==============================
        // 21. 删除手机验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(
            redisKey
        );


        console.log(
            '手机验证码已使用并删除'
        );


        // ==============================
        // 22. 暂时模拟用户 ID
        // ==============================

        // TODO：
        // 以后数据库根据手机号查询真正的 user_id

        const userId = 10001;


        console.log(
            '用户 ID:',
            userId
        );


        // ==============================
        // 23. 生成统一 Token
        // ==============================

        const token =
            crypto.randomBytes(32).toString('hex');


        console.log(
            '生成 Token:',
            token
        );


        // ==============================
        // 24. Redis Session Key
        // ==============================

        const sessionKey =
            `session:${token}`;


        // ==============================
        // 25. Token 有效期
        // 30 天
        // ==============================

        const expiresIn =
            30 * 24 * 60 * 60;


        // ==============================
        // 26. 保存 Session 到 Redis
        // ==============================

        await redisClient.set(
            sessionKey,

            JSON.stringify({

                user_id: userId,

                phone: normalizedPhone,

                login_type: 'phone_code',

                platform: platform

            }),

            {
                EX: expiresIn
            }
        );


        console.log(
            'Session 已保存到 Redis'
        );

        console.log(
            'Redis Key:',
            sessionKey
        );


        // ==============================
        // 27. Web 登录
        // ==============================

        if (platform === 'web') {

            res.cookie(
                'token',
                token,
                {

                    httpOnly: true,

                    // 本地 HTTP 测试
                    // 正式 HTTPS 改成 true
                    secure: false,

                    sameSite: 'lax',

                    maxAge:
                        expiresIn * 1000

                }
            );


            console.log(
                'Web Cookie 已设置'
            );


            return res.json({

                success: true,

                message: '登录成功',

                data: {

                    user_id: userId,

                    phone: normalizedPhone,

                    expires_in: expiresIn

                }

            });

        }


        // ==============================
        // 28. App 登录
        // ==============================

        if (platform === 'app') {

            console.log(
                'App Token 登录成功'
            );


            return res.json({

                success: true,

                message: '登录成功',

                data: {

                    user_id: userId,

                    phone: normalizedPhone,

                    token: token,

                    expires_in: expiresIn

                }

            });

        }

    } catch (error) {

        console.error(
            '=============================='
        );

        console.error(
            '手机号验证码登录失败'
        );

        console.error(
            error
        );

        console.error(
            '=============================='
        );


        return res.status(500).json({

            success: false,

            message: '登录失败'

        });

    }

});


// ==============================
// 检查 Token 是否有效
// ==============================

app.post('/api/account/token/check', async (req, res) => {

    console.log('==============================');
    console.log('检查 Token 有效性');
    console.log('==============================');

    try {

        const { token } = req.body;

        // ==============================
        // 1. 检查有没有 Token
        // ==============================

        if (!token) {

            return res.status(401).json({
                success: false,
                message: '缺少 Token',
                need_login: true
            });

        }

        console.log('收到 Token:', token);

        // ==============================
        // 2. 查询 Redis
        // ==============================

        const redisKey = `session:${token}`;

        const sessionData =
            await redisClient.get(redisKey);

        // ==============================
        // 3. Token 不存在
        // ==============================

        if (!sessionData) {

            console.log('Token 无效或已经过期');
            console.log('要求用户重新登录');

            return res.status(401).json({
                success: false,
                message: '登录已过期，请重新登录',
                need_login: true
            });

        }

        // ==============================
        // 4. Token 有效
        // ==============================

        console.log('Token 验证成功');

        const userData =
            JSON.parse(sessionData);

        console.log(
            '用户 ID:',
            userData.user_id
        );

        // ==============================
        // 5. 返回结果
        // ==============================

        return res.json({
            success: true,
            message: 'Token 有效',
            data: {
                user_id: userData.user_id,
                token: token
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('Token 检查失败');
        console.error(error);
        console.error('==============================');

        return res.status(500).json({
            success: false,
            message: 'Token 检查失败'
        });

    }

});

// ==============================
// 延长 Token 有效期
// ==============================

app.post('/api/account/token/refresh', async (req, res) => {

    console.log('==============================');
    console.log('延长 Token 有效期');
    console.log('==============================');

    try {

        const { token } = req.body;

        // ==============================
        // 1. 检查有没有 Token
        // ==============================

        if (!token) {

            return res.status(401).json({
                success: false,
                message: '缺少 Token',
                need_login: true
            });

        }

        console.log('收到 Token:', token);

        // ==============================
        // 2. 查询 Redis
        // ==============================

        const redisKey = `session:${token}`;

        const sessionData =
            await redisClient.get(redisKey);

        // ==============================
        // 3. Token 不存在
        // ==============================

        if (!sessionData) {

            console.log('Token 无效或已经过期');
            console.log('要求用户重新登录');

            return res.status(401).json({
                success: false,
                message: '登录已过期，请重新登录',
                need_login: true
            });

        }

        // ==============================
        // 4. Token 有效
        // ==============================

        console.log('Token 验证成功');

        const userData =
            JSON.parse(sessionData);

        console.log(
            '用户 ID:',
            userData.user_id
        );

        // ==============================
        // 5. 延长 30 天
        // ==============================

        const expiresIn =
            30 * 24 * 60 * 60;

        await redisClient.expire(
            redisKey,
            expiresIn
        );

        console.log(
            'Token 有效期已延长 30 天'
        );

        // ==============================
        // 6. 返回成功
        // ==============================

        return res.json({
            success: true,
            message: 'Token 有效期已延长',
            data: {
                user_id: userData.user_id,
                token: token,
                expires_in: expiresIn
            }
        });

    } catch (error) {

        console.error('==============================');
        console.error('Token 延期失败');
        console.error(error);
        console.error('==============================');

        return res.status(500).json({
            success: false,
            message: 'Token 延期失败'
        });

    }

});





// ==============================
// 退出登录
// ==============================

app.post('/api/account/logout', async (req, res) => {

    try {

        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: '缺少 Token'
            });
        }

        // Token 对应的 Redis Key
        const redisKey = `session:${token}`;

        // 删除 Token
        await redisClient.del(redisKey);

        return res.json({
            success: true,
            message: '退出登录成功'
        });

    } catch (error) {

        console.error('退出登录失败:', error);

        return res.status(500).json({
            success: false,
            message: '退出登录失败'
        });

    }

});


















app.listen(3000, () => {

    console.log('用户账号 API 已启动');
    console.log('端口: 3000');

});   
