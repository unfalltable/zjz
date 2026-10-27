-- Account service ONLY. MySQL 8.0.21+ / 8.4 LTS, not SQLite/D1.
-- Initialize an explicitly selected EMPTY account database after review/backup.
-- No USE, DROP, IF NOT EXISTS, seed data, account grants or automatic migration.
-- Existing tables intentionally make CREATE fail rather than hide schema drift.

CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Database-assigned account ID',
    email VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NULL,
    backup_email VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NULL,
    phone VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
    password VARCHAR(255) NULL COMMENT 'bcrypt hash; never plaintext',
    nickname VARCHAR(100) NULL,
    avatar_url VARCHAR(1024) NULL,
    google_sub VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    apple_sub VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    tiktok VARCHAR(255) NULL COMMENT 'Reserved compatibility field, not a login provider',
    status TINYINT NOT NULL DEFAULT 1 COMMENT 'Only 1 is enabled; other states deny login',
    auth_version BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Revoke older sessions after sensitive changes',
    country VARCHAR(100) NULL,
    phone_country VARCHAR(100) NULL,
    phone_country_code VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_login_at DATETIME(3) NULL,
    last_login_ip VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_phone (phone_country_code, phone),
    UNIQUE KEY uq_users_google_sub (google_sub),
    UNIQUE KEY uq_users_apple_sub (apple_sub),
    KEY ix_users_status (status, id),
    CONSTRAINT ck_users_email_normalized CHECK (
        email IS NULL OR (email <> '' AND CAST(email AS BINARY) = CAST(LOWER(TRIM(email)) AS BINARY))
    ),
    CONSTRAINT ck_users_backup_email_normalized CHECK (
        backup_email IS NULL OR (backup_email <> '' AND CAST(backup_email AS BINARY) = CAST(LOWER(TRIM(backup_email)) AS BINARY))
    ),
    CONSTRAINT ck_users_phone_country CHECK (
        phone IS NULL OR (phone <> '' AND phone_country_code IS NOT NULL AND phone_country_code <> '')
    ),
    CONSTRAINT ck_users_google_sub CHECK (
        google_sub IS NULL OR (google_sub <> '' AND CAST(google_sub AS BINARY) = CAST(TRIM(google_sub) AS BINARY))
    ),
    CONSTRAINT ck_users_apple_sub CHECK (
        apple_sub IS NULL OR (apple_sub <> '' AND CAST(apple_sub AS BINARY) = CAST(TRIM(apple_sub) AS BINARY))
    )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE user_profiles (
    user_id BIGINT UNSIGNED NOT NULL,
    gender VARCHAR(10) NULL,
    birth_date DATE NULL,
    birth_time TIME NULL,
    birth_longitude DECIMAL(10,7) NULL,
    birth_latitude DECIMAL(9,7) NULL,
    default_cast_method VARCHAR(50) NULL COMMENT 'Imported compatibility only; unused by shopping',
    created_at DATETIME(3) NULL,
    updated_at DATETIME(3) NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_user_profiles_gender CHECK (gender IS NULL OR gender IN ('male', 'female')),
    CONSTRAINT ck_user_profiles_longitude CHECK (birth_longitude IS NULL OR birth_longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_user_profiles_latitude CHECK (birth_latitude IS NULL OR birth_latitude BETWEEN -90 AND 90)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE account_deletion_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(500) NULL,
    status TINYINT NOT NULL DEFAULT 0 COMMENT '0 pending, 1 completed, 2 rejected, 3 withdrawn',
    pending_user_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 0 THEN user_id ELSE NULL END) STORED,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_deletion_pending_user (pending_user_id),
    KEY ix_deletion_user_created (user_id, created_at),
    CONSTRAINT fk_deletion_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_deletion_status CHECK (status IN (0, 1, 2, 3))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE account_restrictions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    restriction_type VARCHAR(30) NOT NULL,
    reason VARCHAR(500) NULL,
    created_at BIGINT UNSIGNED NOT NULL COMMENT 'Unix seconds',
    expire_at BIGINT UNSIGNED NULL COMMENT 'Unix seconds; NULL means permanent',
    status TINYINT NOT NULL DEFAULT 1,
    updated_at BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    KEY ix_restriction_user_active (user_id, status, expire_at, restriction_type),
    CONSTRAINT fk_restriction_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_restriction_type CHECK (restriction_type <> ''),
    CONSTRAINT ck_restriction_status CHECK (status IN (0, 1)),
    CONSTRAINT ck_restriction_expiry CHECK (expire_at IS NULL OR expire_at >= created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
