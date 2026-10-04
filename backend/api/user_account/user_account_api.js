

const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');

const express = require('express');
const app = express();
app.use(express.json());

const GOOGLE_CLIENT_ID = '888693703784-6ehm7av6ogbf6kc0ckurra9par8rh7v8.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

const GOOGLE_REDIRECT_URI =
    'http://localhost:3000/api/account/google/callback';

const googleClient = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);


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

    res.redirect(googleUrl);

});

app.get('/api/account/google/callback', async (req, res) => {

    console.log('Google 登录回来了');

    console.log('Google 返回的数据:', req.query);

    res.json({
        success: true,
        message: 'Google 登录回调成功',
        data: req.query
    });

});



//app端Google注册登录
// ===============================
// App Google 登录
// ===============================

app.post('/api/account/google/app', async (req, res) => {

    console.log('App 请求 Google 登录');

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

        

    } catch (error) {

        console.error('Google ID Token 验证失败:', error.message);

        res.status(401).json({
            success: false,
            message: 'Google 登录失败',
            error: error.message
        });

    }

});



// apple 网页注册登录

// apple  app 网页注册登录


















app.listen(3000, () => {

    console.log('用户账号 API 已启动');
    console.log('端口: 3000');

});   