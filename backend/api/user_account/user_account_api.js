




const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');




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


const APPLE_CLIENT_ID = '你的 Apple Services ID';
const APPLE_CLIENT_SECRET = '你的 Apple Client Secret';
const APPLE_REDIRECT_URI =
    'http://localhost:3000/api/account/apple/callback';




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

        // ① 获取 Google 返回的 code
        const code = req.query.code;

        if (!code) {
            return res.status(400).json({
                success: false,
                message: '没有获取到 Google authorization code'
            });
        }

        // ② 用 code 向 Google 换 Token
        const { tokens } = await googleClient.getToken(code);

        console.log('==============================');
        console.log('Google Token:');
        console.log(tokens);
        console.log('==============================');

        // ③ 验证 Google ID Token
        const ticket = await googleClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: GOOGLE_CLIENT_ID
        });

        // ④ 获取用户详细信息
        const payload = ticket.getPayload();

        console.log('==============================');
        console.log('Google 用户详细信息:');
        console.log(payload);
        console.log('==============================');

        // 单独打印重要字段
        console.log('Google 用户 ID:', payload.sub);
        console.log('Google 邮箱:', payload.email);
        console.log('邮箱是否验证:', payload.email_verified);
        console.log('用户姓名:', payload.name);
        console.log('名字:', payload.given_name);
        console.log('姓氏:', payload.family_name);
        console.log('头像:', payload.picture);
        console.log('语言:', payload.locale);

        //登录或者注册



        // res.json({
        //     success: true,
        //     message: 'Apple App 登录成功',
        //     data: {
        //         apple_id: appleUser.sub,
        //         email: appleUser.email || null,
        //         email_verified: appleUser.email_verified || false
        //     }
        // });

    } catch (error) {

        console.error('==============================');
        console.error('Google 登录失败');
        console.error(error);
        console.error('==============================');

        res.status(401).json({
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

        //登录或者注册



        // res.json({
        //     success: true,
        //     message: 'Apple App 登录成功',
        //     data: {
        //         apple_id: appleUser.sub,
        //         email: appleUser.email || null,
        //         email_verified: appleUser.email_verified || false
        //     }
        // });

        

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

    console.log('Apple 登录回来了');

    console.log('Apple 返回的数据:', req.body);

    try {

        const {
            code,
            user
        } = req.body;

        if (!code) {

            return res.status(400).json({
                success: false,
                message: '缺少 Apple authorization code'
            });

        }

        // 用 authorization code 向 Apple 换取 Token
        const tokenResponse = await appleSignin.getAuthorizationToken(
            code,
            {
                clientID: APPLE_CLIENT_ID,
                clientSecret: APPLE_CLIENT_SECRET,
                redirectUri: APPLE_REDIRECT_URI
            }
        );

        console.log('Apple Token 获取成功');

        // 验证 Apple ID Token
        const appleUser = await appleSignin.verifyIdToken(
            tokenResponse.id_token,
            {
                audience: APPLE_CLIENT_ID
            }
        );

        console.log('Apple 用户信息:');
        console.log('Apple 用户 ID:', appleUser.sub);
        console.log('邮箱:', appleUser.email);
        console.log('邮箱是否验证:', appleUser.email_verified);

        //注册或者登录
        


        // res.json({
        //     success: true,
        //     message: 'Apple App 登录成功',
        //     data: {
        //         apple_id: appleUser.sub,
        //         email: appleUser.email || null,
        //         email_verified: appleUser.email_verified || false
        //     }
        // });


    } catch (error) {

        console.error('Apple 登录验证失败:', error);

        res.status(401).json({
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

        // 验证 Apple identityToken
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

        // 注册或者登录

        //使用App 传过来的邮箱
        


        // res.json({
        //     success: true,
        //     message: 'Apple App 登录成功',
        //     data: {
        //         apple_id: appleUser.sub,
        //         email: appleUser.email || null,
        //         email_verified: appleUser.email_verified || false
        //     }
        // });

    } catch (error) {

        console.error('==============================');
        console.error('Apple App 登录验证失败');
        console.error(error);
        console.error('==============================');

        res.status(401).json({
            success: false,
            message: 'Apple App 登录失败',
            error: error.message
        });

    }

});













app.listen(3000, () => {

    console.log('用户账号 API 已启动');
    console.log('端口: 3000');

});   




