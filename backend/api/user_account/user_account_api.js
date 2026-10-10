const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');


const bcrypt = require('bcrypt');
const crypto = require('crypto');

const cookieParser = require('cookie-parser');
// 登录有效期：30 天，单位为秒
const expiresIn = 30 * 24 * 60 * 60;
const svgCaptcha = require('svg-captcha');
const sharp = require('sharp');
const mysql = require('mysql2/promise');
// 创建 MySQL 数据库连接池
const db_pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',       // 数据库地址
    port: Number(process.env.MYSQL_PORT || 3306),              // 数据库端口
    user: process.env.MYSQL_USER || 'root',            // 数据库用户名
    password: process.env.MYSQL_PASSWORD || '', // 数据库密码
    database: process.env.MYSQL_DATABASE || 'miova_accounts',  // 数据库名称
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 导出连接池，供其他接口使用
module.exports = db_pool;

const { createClient } = require('redis');
const express = require('express');
const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.set('trust proxy', process.env.ACCOUNT_TRUST_PROXY || false);

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

redisClient.on('error', (error) => {

});

const redisReady = redisClient.connect();
redisReady.catch(() => {
    console.error('[account-api] Redis connection failed; check REDIS_URL.');
});

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ||
    'http://localhost:3001/api/account/google/callback';

const googleClient = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);


const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || '';
const APPLE_CLIENT_SECRET = process.env.APPLE_CLIENT_SECRET || '';
const APPLE_REDIRECT_URI = process.env.APPLE_REDIRECT_URI ||
    'http://localhost:3001/api/account/apple/callback';

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









    // 超过限制
    if (count > limit) {
        return false;
    }

    return true;
}


//网页端google 注册登录

app.get('/api/account/google/login', async (req, res) => {



     const googleUrl = googleClient.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'openid',
            'email',
            'profile'
        ]
    });


    //打开这个网址
    res.redirect(googleUrl);

});


app.get('/api/account/google/callback', async (req, res) => {








    let userId;

    try {

        // 获取 Google 返回的 code
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














        // 检查 Google 邮箱
        if (!payload.email) {

            return res.status(400).json({
                success: false,
                message: 'Google 没有返回邮箱'
            });

        }

        //检查邮箱是否验证
        if (!payload.email_verified) {

            return res.status(400).json({
                success: false,
                message: 'Google 邮箱尚未验证'
            });

        }


        //  注册或者登录
        const [users] = await db_pool.execute(
            'SELECT id, email, nickname, avatar_url FROM users WHERE google_sub = ? LIMIT 1',
            [payload.sub]
        );
        // 判断 Google 用户是否已经注册
        if (users.length > 0) {

            // 用户已存在，直接登录
            userId = users[0].id;

            // 更新最后登录时间和最后登录 IP
            await db_pool.execute(
                `UPDATE users
                SET last_login_at = NOW(),
                    last_login_ip = ?,
                    updated_at = NOW()
                WHERE id = ?`,
                [
                    req.ip,
                    userId
                ]
            );





        } else {

            // 用户不存在，创建新用户

            // 生成用户昵称
            const nickname = payload.name || 'user';

            // 获取 Google 头像地址
            const avatarUrl = payload.picture || null;

            // 获取当前秒级时间戳，作为初始用户 ID
            userId = Math.floor(Date.now() / 1000);
            // 循环查询数据库，直到找到没有使用的 ID
            while (true) {

                // 查询当前 ID 是否已经存在
                const [rows] = await db_pool.execute(
                    'SELECT id FROM users WHERE id = ? LIMIT 1',
                    [userId]
                );

                // 如果没有查询到记录，说明这个 ID 可以使用
                if (rows.length === 0) {
                    break;
                }

                // 如果 ID 已经存在，就加 1 后重新查询
                userId++;
            }


            // 插入新用户记录
            const [result] = await db_pool.execute(
                `INSERT INTO users (
                    id,
                    email,
                    nickname,
                    avatar_url,
                    google_sub,
                    status,
                    created_at,
                    updated_at,
                    last_login_at,
                    last_login_ip
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), ?
                )`,
                [
                    userId,
                    payload.email,
                    nickname,
                    avatarUrl,
                    payload.sub,
                    1,
                    req.ip
                ]
            );



        }



            //  生成 Token


            const token = crypto.randomBytes(32).toString('hex');



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



            // ==============================
            // ⑩ 返回登录成功
            // ==============================
            res.cookie(
                'token',
                token,
                {
                    httpOnly: true,
                    // 本地 HTTP 测试
                    // 正式 HTTPS 改成 true
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    // 30 天
                    maxAge:expiresIn * 1000,
                    // 整个网站都可以携带这个 Cookie
                    path: '/'
                }
            );


            return res.json({
                success: true,
                message: 'Google 注册/登录成功',
                data: {
                    user_id: userId,
                    token: token,
                    expires_in: 30 * 24 * 60 * 60,
                    google_id: payload.sub,
                    account: payload.email,
                    account_type: 'google',
                    name: payload.name || null,
                    picture: payload.picture || null
                }
            });





    } catch (error) {






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





    try {

        const { idToken } = req.body;



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











        // ==============================
        // Google 用户身份
        // ==============================

        const googleUserId = payload.sub;


        // ==============================
        // 查询用户是否已经注册
        // ==============================

        const [users] = await db_pool.execute(
            `SELECT id, email, nickname, avatar_url
             FROM users
             WHERE google_sub = ?
             LIMIT 1`,
            [googleUserId]
        );


        // 保存系统用户 ID
        let userId;

        if (users.length > 0) {

            // 使用数据库中已有的用户 ID
            userId = users[0].id;

            // 更新最后登录时间和 IP
            await db_pool.execute(
                `UPDATE users
                 SET last_login_at = NOW(),
                     last_login_ip = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [
                    req.ip,
                    userId
                ]
            );

            //登录



        }else {

            // ==============================
            // 用户尚未注册，创建新用户
            // ==============================

            // 获取当前秒级时间戳，作为初始用户 ID
            userId = Math.floor(Date.now() / 1000);

            // 查询 ID 是否已经存在
            while (true) {

                const [rows] = await db_pool.execute(
                    'SELECT id FROM users WHERE id = ? LIMIT 1',
                    [userId]
                );

                // 如果 ID 不存在，就可以使用
                if (rows.length === 0) {
                    break;
                }

                // 如果 ID 已存在，就加 1 后重新查询
                userId++;
            }
             // 生成用户昵称
            const nickname = payload.name || 'user';

            // 获取 Google 头像地址
            const avatarUrl = payload.picture || null;

            // 插入新用户记录
            await db_pool.execute(
                `INSERT INTO users (
                    id,
                    email,
                    nickname,
                    avatar_url,
                    google_sub,
                    status,
                    created_at,
                    updated_at,
                    last_login_at,
                    last_login_ip
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), ?
                )`,
                [
                    userId,
                    payload.email,
                    nickname,
                    avatarUrl,
                    googleUserId,
                    1,
                    req.ip
                ]
            );


        }








        // ==============================
        // 生成我们自己系统的 Token
        // ==============================

        const token = crypto.randomBytes(32).toString('hex');



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




        // ==============================
        // 返回给 App
        // ==============================
        return res.json({
            success: true,
            message: 'Google 注册/登录成功',
            data: {
                user_id: userId,
                token: token,
                expires_in: 30 * 24 * 60 * 60,
                google_id: payload.sub,
                account: payload.email,
                account_type: 'google',
                name: payload.name || null,
                picture: payload.picture || null
            }
        });


    } catch (error) {






        return res.status(401).json({
            success: false,
            message: 'Google 登录失败',
            error: error.message
        });

    }

});

// ===============================
// Apple 网页登录注册
// ===============================

app.get('/api/account/apple/login', async (req, res) => {



    try {

        const appleUrl = appleSignin.getAuthorizationUrl({
            clientID: APPLE_CLIENT_ID,
            redirectUri: APPLE_REDIRECT_URI,
            scope: 'name email',
            responseMode: 'form_post',
            responseType: 'code'
        });



        res.redirect(appleUrl);

    } catch (error) {



        res.status(500).json({
            success: false,
            message: '生成 Apple 登录地址失败',
            error: error.message
        });

    }

});


// ===============================
// Apple 网页登录注册回调
// ===============================

app.post('/api/account/apple/callback', async (req, res) => {





    try {

        // 获取 Apple 返回的授权码和用户信息
        const { code, user } = req.body;

        // 检查授权码是否存在
        if (!code) {
            return res.status(400).json({
                success: false,
                message: '缺少 Apple authorization code'
            });
        }

        // 使用授权码向 Apple 换取 Token
        const tokenResponse = await appleSignin.getAuthorizationToken(
            code,
            {
                clientID: APPLE_CLIENT_ID,
                clientSecret: APPLE_CLIENT_SECRET,
                redirectUri: APPLE_REDIRECT_URI
            }
        );

        // 验证 Apple ID Token，获取 Apple 用户信息
        const appleUser = await appleSignin.verifyIdToken(
            tokenResponse.id_token,
            {
                audience: APPLE_CLIENT_ID
            }
        );

        // 检查 Apple 用户唯一标识是否存在
        if (!appleUser || !appleUser.sub) {
            return res.status(401).json({
                success: false,
                message: 'Apple 用户信息无效'
            });
        }

        // 获取 Apple 唯一账号标识
        const appleUserId = appleUser.sub;

        // 获取 Apple 邮箱，没有返回时使用 NULL
        const email = appleUser.email || null;




        // ==============================
        // 查询用户是否已经注册
        // ==============================

        const [users] = await db_pool.execute(
            `SELECT id, email, nickname, avatar_url
             FROM users
             WHERE apple_sub = ?
             LIMIT 1`,
            [appleUserId]
        );

        // 保存网站内部用户 ID
        let userId;

        // ==============================
        // 用户已注册，直接登录
        // ==============================

        if (users.length > 0) {

            // 使用数据库中已有的用户 ID
            userId = users[0].id;

            // 更新最后登录时间和 IP
            await db_pool.execute(
                `UPDATE users
                 SET last_login_at = NOW(),
                     last_login_ip = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [
                    req.ip,
                    userId
                ]
            );



        } else {

            // ==============================
            // 用户尚未注册，创建用户
            // ==============================

            // 获取当前秒级时间戳作为初始用户 ID
            userId = Math.floor(Date.now() / 1000);

            // 查询 ID 是否已经存在
            while (true) {

                const [rows] = await db_pool.execute(
                    'SELECT id FROM users WHERE id = ? LIMIT 1',
                    [userId]
                );

                // 没有查询到记录，可以使用该 ID
                if (rows.length === 0) {
                    break;
                }

                // ID 已存在，加 1 后重新查询
                userId++;
            }

            // Apple 通常不提供头像，使用默认昵称
            // Apple 首次授权可能提供姓名，但后续登录未必会提供
            let nickname = 'user';

            // 只在本次请求提供了姓名时使用
            if (user && typeof user === 'object') {
                try {
                    const userInfo =
                        typeof user === 'string'
                            ? JSON.parse(user)
                            : user;

                    if (userInfo.name) {
                        const firstName = userInfo.name.firstName || '';
                        const lastName = userInfo.name.lastName || '';

                        nickname =
                            `${firstName} ${lastName}`.trim() || 'user';
                    }
                } catch (error) {

                }
            }

            // Apple 没有提供头像时保存 NULL
            const avatarUrl = null;

            // 插入新用户记录
            await db_pool.execute(
                `INSERT INTO users (
                    id,
                    email,
                    nickname,
                    avatar_url,
                    apple_sub,
                    status,
                    created_at,
                    updated_at,
                    last_login_at,
                    last_login_ip
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), ?
                )`,
                [
                    userId,
                    email,
                    nickname,
                    avatarUrl,
                    appleUserId,
                    1,
                    req.ip
                ]
            );


        }

        // ==============================
        // 生成系统 Token
        // ==============================

        const token = crypto.randomBytes(32).toString('hex');

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
                email: email
            }),
            {
                EX: 30 * 24 * 60 * 60
            }
        );



        // ==============================
        // 返回统一格式的登录结果
        // 与 Google 登录接口保持一致
        // ==============================
        res.cookie(
                'token',
                token,
                {
                    httpOnly: true,
                    // 本地 HTTP 测试
                    // 正式 HTTPS 改成 true
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    // 30 天
                    maxAge:expiresIn * 1000,
                    // 整个网站都可以携带这个 Cookie
                    path: '/'
                }
            );

        return res.json({
            success: true,
            message: 'Apple 注册/登录成功',
            data: {
                user_id: userId,
                token: token,
                expires_in: 30 * 24 * 60 * 60,
                apple_id: appleUserId,
                account: email,
                account_type:'apple',
                name: null,
                picture: null
            }
        });

    } catch (error) {






        return res.status(500).json({
            success: false,
            message: 'Apple 注册/登录失败'
        });

    }

});

//apple账号的app端应用的登录注册


app.post('/api/account/apple/app', async (req, res) => {





    try {

        // 获取 App 传来的参数
        const {
            identityToken,
            authorizationCode,
            user,
            email
        } = req.body;

        // 检查 Apple identityToken 是否存在
        if (!identityToken) {
            return res.status(400).json({
                success: false,
                message: '缺少 Apple identityToken'
            });
        }

        // 验证 Apple identityToken，获取 Apple 用户信息
        const appleUser = await appleSignin.verifyIdToken(
            identityToken,
            {
                audience: APPLE_CLIENT_ID
            }
        );

        // 获取 Apple 用户唯一标识
        const appleUserId = appleUser.sub;

        // 检查 Apple 用户唯一标识
        if (!appleUserId) {
            return res.status(401).json({
                success: false,
                message: '无法获取 Apple 用户唯一标识'
            });
        }

        // 获取邮箱，优先使用 Apple 验证结果中的邮箱
        const userEmail = appleUser.email || email || null;

        // 默认使用 user 作为昵称
        let nickname = 'user';

        // 尝试解析 App 传来的 Apple 用户姓名
        try {
            const userInfo = typeof user === 'string'
                ? JSON.parse(user)
                : user;

            // 提取名字和姓氏
            const firstName = userInfo?.name?.firstName || '';
            const lastName = userInfo?.name?.lastName || '';

            // 将姓名拼接成昵称
            nickname = `${firstName} ${lastName}`.trim() || 'user';

        } catch (error) {
            // 姓名解析失败时，使用默认昵称

        }

        // 根据 Apple 唯一标识查询数据库中的用户
        const [users] = await db_pool.execute(
            'SELECT id, nickname FROM users WHERE apple_sub = ? LIMIT 1',
            [appleUserId]
        );

        // 声明系统用户 ID
        let userId;

        // 判断用户是否已经注册
        if (users.length > 0) {

            // 用户已存在，使用数据库中的用户 ID
            userId = users[0].id;

            // 更新最后登录时间和最后登录 IP
            await db_pool.execute(
                `UPDATE users
                 SET last_login_at = NOW(),
                     last_login_ip = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [req.ip, userId]
            );

            // 已有昵称时不覆盖用户原来的昵称
            nickname = users[0].nickname || nickname;


        } else {

            // 获取当前秒级时间戳作为初始用户 ID
            userId = Math.floor(Date.now() / 1000);

            // 检查用户 ID 是否已存在，重复时加 1
            while (true) {

                const [existingUsers] = await db_pool.execute(
                    'SELECT id FROM users WHERE id = ? LIMIT 1',
                    [userId]
                );

                // 当前 ID 未使用，可以使用
                if (existingUsers.length === 0) {
                    break;
                }

                // 当前 ID 已存在，递增 1 后继续检查
                userId++;
            }

            // 将新用户写入数据库
            await db_pool.execute(
                `INSERT INTO users (
                    id,
                    email,
                    nickname,
                    avatar_url,
                    apple_sub,
                    status,
                    created_at,
                    updated_at,
                    last_login_at,
                    last_login_ip
                ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), ?)`,
                [
                    userId,
                    userEmail,
                    nickname,
                    null,
                    appleUserId,
                    1,
                    req.ip
                ]
            );


        }

        // 生成系统自己的登录 Token
        const token = crypto.randomBytes(32).toString('hex');

        // 拼接 Redis 会话存储键
        const sessionKey = `session:${token}`;

        // 将登录状态保存到 Redis，有效期 30 天
        await redisClient.set(
            sessionKey,
            JSON.stringify({
                user_id: userId,
                account: userEmail,
                account_type: 'apple',
                apple_id: appleUserId
            }),
            {
                EX: 30 * 24 * 60 * 60
            }
        );

        // 返回统一的注册/登录成功结果
        return res.json({
            success: true,
            message: 'Apple 注册/登录成功',
            data: {
                user_id: userId,
                token: token,
                expires_in: 30 * 24 * 60 * 60,
                apple_id: appleUserId,
                account: userEmail,
                account_type:'apple',
                name: nickname,
                picture: null
            }
        });

    } catch (error) {

        // 记录服务端错误详情


        // 向 App 返回错误信息，不暴露内部异常详情
        return res.status(500).json({
            success: false,
            message: 'Apple App 注册/登录失败'
        });
    }

});


// 图片验证码生成接口
// ==============================

app.post('/api/account/captcha/image', async (req, res) => {





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



        return res.status(500).json({

            success: false,

            message: '图片验证码生成失败'

        });

    }

});


// 图片验证码验证接口
// ==============================


app.post('/api/account/captcha/image/verify', async (req, res) => {





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



        return res.status(500).json({

            success: false,

            message: '验证码验证失败'

        });

    }

});

// 滑动验证码生成接口
// ==============================


app.post('/api/account/captcha/slider', async (req, res) => {





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



        return res.status(500).json({

            success: false,

            message: '滑动验证码生成失败'

        });

    }

});

// 滑动验证码验证接口
// ==============================


app.post('/api/account/captcha/slider/verify', async (req, res) => {





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





        // ==============================
        // 验证失败
        // ==============================

        if (!Number.isFinite(difference) || difference > tolerance) {

            return res.status(400).json({

                success: false,

                message: '滑动位置错误'

            });

        }



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


    // 这里以后实现真正的邮件发送
}

// 发送邮箱注册验证码
app.post('/api/account/email/send-code', async (req, res) => {






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



        // ==============================
        // 4. 使用一次后立即删除
        // ==============================

        await redisClient.del(captchaTokenKey);

        // ==============================
        // 5. 统一邮箱格式
        // ==============================

        const normalizedEmail =
            email.trim().toLowerCase();



        // ==============================
        // 6. 生成 6 位验证码
        // ==============================

        const code = Math.floor(
            100000 + Math.random() * 900000
        ).toString();



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


        const [existingUsers] = await db_pool.execute(
            'SELECT id FROM users WHERE email = ? LIMIT 1',
            [normalizedEmail]
        );

        // 邮箱已经注册，不允许重复注册
        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: '该邮箱已经注册'
            });
        }


        const redisKey =
            `email_register_code:${normalizedEmail}`;

        // ==============================
        // 4. 从 Redis 获取验证码
        // ==============================

        const savedCode = await redisClient.get(
            redisKey
        );




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



        // ==============================
        // 7. 注册用户
        // ==============================











        // ==============================
        // 8. 生成用户 ID
        // ==============================

        // 使用当前秒级时间戳作为初始用户 ID
        let userId = Math.floor(Date.now() / 1000);

        // 如果 ID 已存在，就加 1，直到找到未使用的 ID
        while (true) {

            const [existingIds] = await db_pool.execute(
                'SELECT id FROM users WHERE id = ? LIMIT 1',
                [userId]
            );

            // ID 不存在，可以使用
            if (existingIds.length === 0) {
                break;
            }

            // ID 已存在，加 1 后继续检查
            userId++;
        }

        // ==============================
        // 9. 密码加密
        // ==============================

        // 使用 bcrypt 对密码进行哈希处理
        const hashedPassword = await bcrypt.hash(password, 12);

        // ==============================
        // 10. 插入新用户
        // ==============================

        await db_pool.execute(
            `INSERT INTO users (
                id,
                email,
                phone,
                password,
                nickname,
                avatar_url,
                status,
                created_at,
                updated_at,
                last_login_at,
                last_login_ip
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), ?)`,
            [
                userId,
                normalizedEmail,
                null,
                hashedPassword,
                'user',
                null,
                1,
                req.ip
            ]
        );









        // ==============================
        // 8. 生成我们自己系统的 Token
        // ==============================

        const token = crypto.randomBytes(32).toString('hex');



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




        // ==============================
        // 10. 删除注册验证码
        // 防止验证码重复使用
        // ==============================

        await redisClient.del(redisKey);



        // ==============================
        // 11. 注册完成，自动登录
        // ==============================

        return res.json({
            success: true,
            message: '注册成功并已登录',

            data: {
                user_id: userId,
                account: normalizedEmail,
                account_type:'email',
                token: token,
                expires_in: 30 * 24 * 60 * 60
            }
        });

    } catch (error) {






        return res.status(500).json({
            success: false,
            message: '注册失败'
        });

    }

});



//手机发送短信
async function sendSms(phoneCountryCode, phone, message) {








    // TODO:
    // 这里以后接入 Twilio、AWS SNS、阿里云等短信服务
    // 例如：
    // await xxx.send(phoneCountryCode, phone, message);

    return true;
}

// ==============================
// 发送注册短信验证码
// ==============================
app.post('/api/account/phone/send-code', async (req, res) => {





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
            phone_country_code,
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



        // 5. 处理手机号
        const normalizedPhone = phone.trim();



        // 6. 生成 6 位验证码
        const code =
            Math.floor(
                100000 +
                Math.random() * 900000
            ).toString();



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




        // 8. 生成短信内容
        const message =
            `您的注册验证码是：${code}，5分钟内有效。`;

        // 9. 发送短信
        await sendSms(
            phone_country_code,
            normalizedPhone,
            message
        );



        // 10. 返回结果
        return res.json({
            success: true,
            message: '短信验证码发送成功',
            data: {
                expires_in: 5 * 60
            }
        });

    } catch (error) {






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





    try {

        const {
            phone,
            code,
            password,
            country,
            phone_country,
            phone_country_code
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


        // ==============================
        // 8. 查询手机号是否已经注册
        // ==============================

        const [existingUsers] = await db_pool.execute(
            'SELECT id FROM users WHERE phone = ? LIMIT 1',
            [normalizedPhone]
        );

        // 手机号已经注册，不允许重复注册
        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: '该手机号已经注册'
            });
        }


        // ==============================
        // 5. 查询 Redis 验证码
        // ==============================

        const redisKey =
            `phone_register_code:${normalizedPhone}`;

        const savedCode =
            await redisClient.get(redisKey);





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




        // ==============================
        // 9. 生成用户 ID
        // ==============================

        // 使用当前秒级时间戳作为初始用户 ID
        let userId = Math.floor(Date.now() / 1000);

        // 如果 ID 已存在，就加 1，直到找到未使用的 ID
        while (true) {

            const [existingIds] = await db_pool.execute(
                'SELECT id FROM users WHERE id = ? LIMIT 1',
                [userId]
            );

            // ID 不存在，可以使用
            if (existingIds.length === 0) {
                break;
            }

            // ID 已存在，加 1 后继续检查
            userId++;
        }

        // ==============================
        // 10. 密码加密
        // ==============================

        // 使用 bcrypt 对密码进行哈希处理
        const bcrypt = require('bcrypt');

        const hashedPassword = await bcrypt.hash(password, 12);

        // ==============================
        // 11. 创建用户
        // ==============================

        await db_pool.execute(
            `INSERT INTO users (
                id,
                phone,
                country,
                phone_country,
                phone_country_code,
                password,
                nickname,
                avatar_url,
                status,
                created_at,
                updated_at,
                last_login_at,
                last_login_ip
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), ?)`,
            [
                userId,
                normalizedPhone,
                country,
                phone_country,
                phone_country_code,
                hashedPassword,
                'user',
                null,
                1,
                req.ip
            ]
        );



        // ==============================
        // 9. 生成 Token
        // ==============================

        const token =
            crypto.randomBytes(32).toString('hex');



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



        // ==============================
        // 11. 删除注册验证码
        // ==============================

        await redisClient.del(redisKey);



        // ==============================
        // 12. 返回注册 + 登录成功
        // ==============================

        return res.json({
            success: true,
            message: '注册成功并已登录',
            data: {
                user_id: userId,
                account: normalizedPhone,
                account_type: 'phone',
                token: token,
                expires_in: 30 * 24 * 60 * 60
            }
        });

    } catch (error) {






        return res.status(500).json({
            success: false,
            message: '注册失败'
        });

    }

});


// ==============================
// 邮箱 / 手机号+ 密码登录
// ==============================

app.post('/api/account/login/password', async (req, res) => {





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







        // ==============================
        // 10. 滑动验证码验证失败
        // ==============================

        if (!Number.isFinite(difference) || difference > tolerance) {

            return res.status(400).json({
                success: false,
                message: '滑动位置错误'
            });

        }



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




        // ==============================
        // 14. 根据邮箱或手机号查询用户
        // ==============================

        let sql;
        let params;

        // 根据账号类型选择查询条件
        if (accountType === 'email') {

            sql = `
                SELECT id, email, phone, password, status
                FROM users
                WHERE email = ?
                LIMIT 1
            `;

            params = [normalizedAccount];

        } else {

            sql = `
                SELECT id, email, phone, password, status
                FROM users
                WHERE phone = ?
                LIMIT 1
            `;


            params = [account.trim()];
        }

        // 查询数据库
        const [users] = await db_pool.execute(sql, params);

        // 账号不存在
        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: '账号或密码错误'
            });
        }

        // 获取数据库中的用户信息
        const dbUser = users[0];

        // ==============================
        // 15. 检查用户状态
        // ==============================

        // status = 1 表示正常用户
        if (dbUser.status !== 1) {
            return res.status(403).json({
                success: false,
                message: '账号当前不可登录'
            });
        }

        // ==============================
        // 16. 验证密码
        // ==============================

        // 数据库中的 password 保存的是 bcrypt 哈希值
        const passwordMatch = await bcrypt.compare(
            password,
            dbUser.password
        );

        // 密码错误
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: '账号或密码错误'
            });
        }

        // ==============================
        // 17. 获取真实用户 ID
        // ==============================

        const userId = dbUser.id;

        // ==============================
        // 18. 更新最后登录时间和 IP
        // ==============================

        await db_pool.execute(
            `UPDATE users
            SET last_login_at = NOW(),
                last_login_ip = ?,
                updated_at = NOW()
            WHERE id = ?`,
            [req.ip, userId]
        );






        // ==============================
        // 16. 生成统一 Token
        // ==============================

        const token =
            crypto.randomBytes(32).toString('hex');



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
                    secure: process.env.NODE_ENV === 'production',

                    sameSite: 'lax',

                    // 30 天
                    maxAge:
                        expiresIn * 1000,
                    // 整个网站都可以携带这个 Cookie
                    path: '/'
                }
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



        // ==============================
        // 4. captcha_token 使用一次后删除
        // ==============================

        await redisClient.del(captchaTokenKey);

        // ==============================
        // 5. 统一邮箱格式
        // ==============================

        const normalizedEmail =
            email.trim().toLowerCase();



        // ==============================
        // 6. 生成 6 位登录验证码
        // ==============================

        const code = Math.floor(
            100000 + Math.random() * 900000
        ).toString();



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






        return res.status(500).json({
            success: false,
            message: '发送登录验证码失败'
        });

    }

});



// ==============================
// 邮箱验证码登录
// ==============================

app.post('/api/account/login/email/code', async (req, res) => {





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









        // ==============================
        // 14. 滑块验证失败
        // ==============================

        if (
            !Number.isFinite(difference) || difference > tolerance
        ) {

            return res.status(400).json({
                success: false,
                message: '滑动位置错误'
            });

        }





        // ==============================
        // 15. 删除滑块验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(
            captchaRedisKey
        );





        // ==============================
        // 16. 统一邮箱
        // ==============================

        const normalizedEmail =
            email.trim().toLowerCase();





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





        // ==============================
        // 21. 删除邮箱验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(
            redisKey
        );





        // ==============================
        // 22. 查询数据库中的用户
        // ==============================

        const [users] = await db_pool.execute(
            `
            SELECT id, email, status
            FROM users
            WHERE email = ?
            LIMIT 1
            `,
            [normalizedEmail]
        );

        // 邮箱没有注册
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: '该邮箱尚未注册'
            });
        }

        // 获取用户信息
        const dbUser = users[0];

        // 获取真实用户 ID
        const userId = dbUser.id;

        // 检查账号状态
        if (dbUser.status !== 1) {
            return res.status(403).json({
                success: false,
                message: '账号当前不可登录'
            });
        }

        // 更新最后登录时间、IP 和更新时间
        await db_pool.execute(
            `
            UPDATE users
            SET last_login_at = NOW(),
                last_login_ip = ?,
                updated_at = NOW()
            WHERE id = ?
            `,
            [req.ip, userId]
        );




        // ==============================
        // 23. 生成统一 Token
        // ==============================

        const token =
            crypto.randomBytes(32).toString('hex');





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
                account: normalizedEmail,
                account_type: 'email',
                login_type: 'email_code',
                platform: platform
            }),
            {
                EX: expiresIn
            }
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
                    secure: process.env.NODE_ENV === 'production',

                    sameSite: 'lax',

                    // 30 天
                    maxAge:
                        expiresIn * 1000,
                    // 整个网站都可以携带这个 Cookie
                    path: '/'
                }
            );





            return res.json({
                success: true,
                message: '登录成功',
                data: {
                    user_id: userId,
                    account: normalizedEmail,
                    account_type: 'email',
                    expires_in: expiresIn
                }
            });


        }



        // ==============================
        // 28. App 登录
        // ==============================

        if (platform === 'app') {





            return res.json({
                success: true,
                message: '登录成功',
                data: {
                    user_id: userId,
                    account: normalizedEmail,
                    account_type: 'email',
                    token: token,
                    expires_in: expiresIn
                }
            });

        }


    } catch (error) {










        return res.status(500).json({

            success: false,

            message: '登录失败'

        });

    }

});



// 发送登录手机号验证码接口
app.post('/api/account/phone/login/send-code', async (req, res) => {





    try {

        // ==============================
        // 1. 检查 IP 短信发送频率
        // ==============================

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

        // ==============================
        // 2. 获取请求参数
        // ==============================

        const {
            phone,
            captcha_token
        } = req.body;

        // ==============================
        // 3. 检查手机号
        // ==============================

        if (
            typeof phone !== 'string' ||
            !phone.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: '请输入手机号'
            });
        }

        // ==============================
        // 4. 检查滑块验证令牌
        // ==============================

        if (!captcha_token) {
            return res.status(400).json({
                success: false,
                message: '请先完成验证码验证'
            });
        }

        // ==============================
        // 5. 统一手机号格式
        // 手机号不包含国家区号
        // ==============================

        const normalizedPhone = phone.trim();

        // ==============================
        // 6. 查询数据库中的手机号和国家区号
        // ==============================

        const [users] = await db_pool.execute(
            `
            SELECT id, phone, phone_country_code, status
            FROM users
            WHERE phone = ?
            LIMIT 1
            `,
            [normalizedPhone]
        );

        // 手机号没有注册
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: '该手机号尚未注册'
            });
        }

        // 获取用户信息
        const dbUser = users[0];

        // 检查账号状态
        if (dbUser.status !== 1) {
            return res.status(403).json({
                success: false,
                message: '账号当前不可登录'
            });
        }

        // ==============================
        // 7. 获取手机号国家区号
        // 例如 +86、+1、+65
        // ==============================

        const phoneCountryCode = dbUser.phone_country_code;

        if (
            typeof phoneCountryCode !== 'string' ||
            !/^\+\d{1,4}$/.test(phoneCountryCode)
        ) {
            return res.status(400).json({
                success: false,
                message: '该手机号的国家区号未设置或格式错误'
            });
        }

        // ==============================
        // 8. 拼接完整国际手机号
        // 例如 +86 和 13800138000
        // ==============================

        const fullPhone =
            `${phoneCountryCode}${normalizedPhone}`;

        // ==============================
        // 9. 检查滑块验证令牌
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

        // ==============================
        // 10. 删除已使用的滑块验证令牌
        // ==============================

        await redisClient.del(captchaTokenKey);

        // ==============================
        // 11. 生成 6 位短信验证码
        // 文件顶部需要引入 crypto
        // ==============================

        const code = crypto.randomInt(
            100000,
            1000000
        ).toString();

        // ==============================
        // 12. 生成 Redis 验证码 Key
        // ==============================

        const redisKey =
            `phone_login_code:${normalizedPhone}`;

        // ==============================
        // 13. 生成短信内容
        // ==============================

        const message =
            `您的登录验证码是：${code}，5分钟内有效。`;

        // ==============================
        // 14. 发送短信
        // 只发送一次
        // ==============================

        await sendSms(
            phoneCountryCode,
            normalizedPhone,
            message
        );

        // ==============================
        // 15. 短信发送成功后保存验证码
        // 5 分钟过期
        // ==============================

        await redisClient.set(
            redisKey,
            code,
            {
                EX: 5 * 60
            }
        );

        // ==============================
        // 16. 返回结果
        // ==============================

        return res.json({
            success: true,
            message: '登录验证码发送成功',
            data: {
                expires_in: 5 * 60
            }
        });

    } catch (error) {






        return res.status(500).json({
            success: false,
            message: '发送登录验证码失败'
        });

    }

});



// ==============================
// 手机号 + 手机验证码登录
// ==============================

app.post('/api/account/login/phone/code', async (req, res) => {





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









        // ==============================
        // 14. 滑块验证失败
        // ==============================

        if (
            !Number.isFinite(difference) || difference > tolerance
        ) {

            return res.status(400).json({
                success: false,
                message: '滑动位置错误'
            });

        }





        // ==============================
        // 15. 删除滑块验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(
            captchaRedisKey
        );





        // ==============================
        // 16. 统一手机号格式
        // ==============================

        const normalizedPhone =
            phone.trim();





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





        // ==============================
        // 21. 删除手机验证码
        // 防止重复使用
        // ==============================

        await redisClient.del(
            redisKey
        );





        // ==============================
        // 22. 查询数据库中的用户
        // ==============================

        const [users] = await db_pool.execute(
            `
            SELECT id, phone, status
            FROM users
            WHERE phone = ?
            LIMIT 1
            `,
            [normalizedPhone]
        );

        // 检查手机号是否已注册
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: '该手机号尚未注册'
            });
        }

        // 获取用户信息
        const dbUser = users[0];

        // 获取真实用户 ID
        const userId = dbUser.id;

        // 检查账号状态
        if (dbUser.status !== 1) {
            return res.status(403).json({
                success: false,
                message: '账号当前不可登录'
            });
        }

        // 更新最后登录时间、登录 IP 和更新时间
        await db_pool.execute(
            `
            UPDATE users
            SET last_login_at = NOW(),
                last_login_ip = ?,
                updated_at = NOW()
            WHERE id = ?
            `,
            [req.ip, userId]
        );





        // ==============================
        // 23. 生成统一 Token
        // ==============================

        const token =
            crypto.randomBytes(32).toString('hex');





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
                account: normalizedPhone,
                account_type: 'phone',
                login_type: 'phone_code',
                platform: platform

            }),

            {
                EX: expiresIn
            }
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
                    secure: process.env.NODE_ENV === 'production',

                    sameSite: 'lax',

                    // 30 天
                    maxAge:
                        expiresIn * 1000,
                    // 整个网站都可以携带这个 Cookie
                    path: '/'
                }
            );




            return res.json({

                success: true,

                message: '登录成功',

                data: {
                    user_id: userId,
                    account: normalizedPhone,
                    account_type: 'phone',
                    expires_in: expiresIn


                }

            });

        }


        // ==============================
        // 28. App 登录
        // ==============================

        if (platform === 'app') {




            return res.json({

                success: true,

                message: '登录成功',

                data: {
                    user_id: userId,
                    account: normalizedPhone,
                    account_type: 'phone',
                    token: token,
                    expires_in: expiresIn


                }

            });

        }

    } catch (error) {










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




            return res.status(401).json({
                success: false,
                message: '登录已过期，请重新登录',
                need_login: true
            });

        }

        // ==============================
        // 4. Token 有效
        // ==============================



        const userData =
            JSON.parse(sessionData);



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




            return res.status(401).json({
                success: false,
                message: '登录已过期，请重新登录',
                need_login: true
            });

        }

        // ==============================
        // 4. Token 有效
        // ==============================



        const userData =
            JSON.parse(sessionData);



        // ==============================
        // 5. 延长 30 天
        // ==============================

        const expiresIn =
            30 * 24 * 60 * 60;

        await redisClient.expire(
            redisKey,
            expiresIn
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



        return res.status(500).json({
            success: false,
            message: '退出登录失败'
        });

    }

});


















// app.listen(3000, () => {

//     console.log('用户账号 API 已启动');
//     console.log('端口: 3000');

// });

// Preserve the original connection-pool export for other account modules.
module.exports.app = app;
module.exports.redisClient = redisClient;
module.exports.redisReady = redisReady;
