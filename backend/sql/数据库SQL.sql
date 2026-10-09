




CREATE TABLE users (
    id BIGINT COMMENT '用户ID',

    email VARCHAR(320) COMMENT '用户邮箱',

    phone VARCHAR(30) COMMENT '用户手机号',

    password VARCHAR(255) COMMENT '用户密码',

    nickname VARCHAR(100) COMMENT '用户昵称',

    avatar_url VARCHAR(1024) COMMENT '用户头像地址',


    google_sub VARCHAR(255) COMMENT 'Google账号唯一标识',

    apple_sub VARCHAR(255) COMMENT 'Apple账号唯一标识',

    tiktok VARCHAR(255) COMMENT 'TikTok账号唯一标识',

    status TINYINT COMMENT '用户状态',

    country VARCHAR(100) NULL COMMENT '用户所在国家',

    phone_country VARCHAR(100) NULL COMMENT '手机号所属国家',

    phone_country_code VARCHAR(10) NULL COMMENT '手机号国家电话区号',

    created_at DATETIME COMMENT '用户注册时间',

    updated_at DATETIME COMMENT '用户信息最后修改时间',

    last_login_at DATETIME COMMENT '用户最后一次登录时间',

    last_login_ip VARCHAR(45) COMMENT '用户最后一次登录IP'
);

id就用当前秒级时间戳，如果有重复就加一 重复再加一


