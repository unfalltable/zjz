'use strict';

// Read-only schema/data audit. Importing this module neither loads a driver nor connects.
// Reports counts and schema identifiers only; never emits contact details or secrets.
const accountTables = Object.freeze(['users', 'user_profiles', 'account_deletion_requests', 'account_restrictions']);
const expectedColumns = Object.freeze({
  users: ['id', 'email', 'backup_email', 'phone', 'password', 'nickname', 'avatar_url', 'google_sub', 'apple_sub', 'tiktok',
    'status', 'auth_version', 'country', 'phone_country', 'phone_country_code', 'created_at', 'updated_at', 'last_login_at', 'last_login_ip'],
  user_profiles: ['user_id', 'gender', 'birth_date', 'birth_time', 'birth_longitude', 'birth_latitude', 'default_cast_method', 'created_at', 'updated_at'],
  account_deletion_requests: ['id', 'user_id', 'reason', 'status', 'pending_user_id', 'created_at', 'updated_at'],
  account_restrictions: ['id', 'user_id', 'restriction_type', 'reason', 'created_at', 'expire_at', 'status', 'updated_at'],
});
const requiredIndexes = Object.freeze({
  users: [['id'], ['email'], ['phone_country_code', 'phone'], ['google_sub'], ['apple_sub']],
  user_profiles: [['user_id']],
  account_deletion_requests: [['id'], ['pending_user_id']],
  account_restrictions: [['id']],
});
function issue(code, table, additional = {}) { return { severity: 'error', code, table, ...additional }; }
function supportedMySql(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  if (!match || /mariadb/i.test(version)) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 8 || major === 8 && (minor > 0 || patch >= 21);
}
function inspectMetadata({ tables = [], columns = [], indexes = [], foreignKeys = [], checks = [] }) {
  const issues = [];
  const knownTables = new Map(tables.map(row => [row.tableName, row]));
  const knownColumns = new Map(columns.map(row => [`${row.tableName}.${row.columnName}`, row]));
  for (const name of accountTables) {
    const table = knownTables.get(name);
    if (!table) { issues.push(issue('missing_table', name)); continue; }
    if (table.engine !== 'InnoDB') issues.push(issue('engine_must_be_innodb', name));
    if (!String(table.collation ?? '').startsWith('utf8mb4_')) issues.push(issue('table_charset_must_be_utf8mb4', name));
    for (const column of expectedColumns[name]) if (!knownColumns.has(`${name}.${column}`)) issues.push(issue('missing_column', name, { column }));
    const primaryColumns = indexes.filter(row => row.tableName === name && row.indexName === 'PRIMARY')
      .sort((a, b) => Number(a.sequence) - Number(b.sequence)).map(row => row.columnName);
    if (JSON.stringify(primaryColumns) !== JSON.stringify([name === 'user_profiles' ? 'user_id' : 'id'])) issues.push(issue('primary_key_required', name));
    for (const key of requiredIndexes[name]) {
      const groups = new Map();
      for (const row of indexes.filter(row => row.tableName === name && Number(row.nonUnique) === 0)) {
        const values = groups.get(row.indexName) ?? []; values.push(row); groups.set(row.indexName, values);
      }
      const exists = [...groups.values()].some(rows => {
        const sorted = rows.sort((a, b) => Number(a.sequence) - Number(b.sequence));
        return sorted.length === key.length && sorted.every((row, index) => row.columnName === key[index] && row.prefixLength == null);
      });
      if (!exists) issues.push(issue('missing_full_unique_index', name, { columns: key }));
    }
  }
  for (const [table, column] of [['users', 'id'], ['users', 'auth_version'], ['user_profiles', 'user_id'], ['account_deletion_requests', 'id'], ['account_deletion_requests', 'user_id'], ['account_restrictions', 'id'], ['account_restrictions', 'user_id']]) {
    const value = knownColumns.get(`${table}.${column}`);
    if (value && (!/^bigint(?:\(\d+\))? unsigned$/i.test(value.columnType) || value.nullable !== 'NO')) issues.push(issue('unsigned_nonnullable_bigint_required', table, { column }));
  }
  for (const table of ['users', 'account_deletion_requests', 'account_restrictions']) {
    const value = knownColumns.get(`${table}.id`);
    if (value && !/auto_increment/i.test(value.extra ?? '')) issues.push(issue('auto_increment_required', table, { column: 'id' }));
  }
  const pending = knownColumns.get('account_deletion_requests.pending_user_id');
  if (pending && (!/STORED GENERATED/i.test(pending.extra ?? '') ||
      !/case\s+when\s+\(?\s*`?status`?\s*=\s*0\s*\)?\s+then\s+`?user_id`?\s+else\s+null\s+end/i.test(pending.generationExpression ?? ''))) {
    issues.push(issue('pending_deletion_generated_expression_required', 'account_deletion_requests', { column: 'pending_user_id' }));
  }
  for (const name of ['email', 'phone', 'google_sub', 'apple_sub']) {
    const value = knownColumns.get(`users.${name}`);
    if (value && value.nullable !== 'YES') issues.push(issue('optional_identity_must_allow_null', 'users', { column: name }));
  }
  for (const name of ['google_sub', 'apple_sub']) {
    const value = knownColumns.get(`users.${name}`);
    if (value && value.collation !== 'utf8mb4_0900_bin') issues.push(issue('oauth_subject_exact_collation_required', 'users', { column: name }));
  }
  const email = knownColumns.get('users.email');
  if (email && email.collation !== 'utf8mb4_0900_as_ci') issues.push(issue('email_normalization_collation_required', 'users', { column: 'email' }));
  for (const [table, fields] of Object.entries({
    users: { email: 320, backup_email: 320, phone: 30, password: 255, nickname: 100, avatar_url: 1024, google_sub: 255, apple_sub: 255, phone_country_code: 10, last_login_ip: 45 },
    account_deletion_requests: { reason: 500 }, account_restrictions: { restriction_type: 30, reason: 500 },
  })) for (const [column, size] of Object.entries(fields)) {
    const value = knownColumns.get(`${table}.${column}`);
    if (value && (!/^varchar\(/i.test(value.columnType) || Number(value.maximumLength) < size)) issues.push(issue('column_capacity_required', table, { column, minimumLength: size }));
  }
  for (const name of ['user_profiles', 'account_deletion_requests', 'account_restrictions']) {
    if (knownTables.has(name) && !foreignKeys.some(key => key.tableName === name && key.columnName === 'user_id' && key.referencedTable === 'users' && key.referencedColumn === 'id' && key.deleteRule === 'RESTRICT' && key.updateRule === 'RESTRICT')) issues.push(issue('restrict_user_foreign_key_required', name));
  }
  const mandatoryChecks = {
    users: ['ck_users_email_normalized', 'ck_users_backup_email_normalized', 'ck_users_phone_country', 'ck_users_google_sub', 'ck_users_apple_sub'],
    user_profiles: ['ck_user_profiles_gender', 'ck_user_profiles_longitude', 'ck_user_profiles_latitude'],
    account_deletion_requests: ['ck_deletion_status'],
    account_restrictions: ['ck_restriction_type', 'ck_restriction_status', 'ck_restriction_expiry'],
  };
  for (const [name, constraints] of Object.entries(mandatoryChecks)) if (knownTables.has(name)) {
    for (const constraint of constraints) if (!checks.some(row => row.tableName === name && row.constraintName === constraint && row.enforced === 'YES')) issues.push(issue('enforced_check_required', name, { constraint }));
  }
  return issues;
}
async function rows(connection, statement, values = []) {
  if (!/^\s*SELECT\b/i.test(statement) || /;|\b(?:INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE|LOCK\s+IN\s+SHARE)\b/i.test(statement)) throw new Error('audit_read_only_query_required');
  // Server-side execution limit for read-only scans; not a client-side race that
  // would abandon a still-running query. No SET or session mutations are needed.
  const bounded = statement.replace(/^(\s*SELECT)\b/i, '$1 /*+ MAX_EXECUTION_TIME(15000) */');
  const result = await connection.execute(bounded, values);
  if (!Array.isArray(result[0])) throw new Error('audit_invalid_driver_result');
  return result[0];
}
async function count(connection, sql) {
  const result = await rows(connection, sql);
  const value = String(result[0]?.count ?? '');
  if (!/^\d+$/.test(value)) throw new Error('audit_invalid_count');
  return value;
}
async function auditAccountSchema(connection, { scanData = true } = {}) {
  const [server = {}] = await rows(connection, 'SELECT VERSION() AS version, @@SESSION.sql_mode AS sqlMode');
  const issues = [];
  if (!supportedMySql(server.version)) return { ok: false, scope: 'account-mysql-read-only', issues: [issue('mysql_8_0_21_or_newer_required', 'database')], dataScanned: false };
  if (!/\bSTRICT_(?:ALL|TRANS)_TABLES\b/.test(server.sqlMode ?? '')) issues.push(issue('strict_sql_mode_required', 'database'));
  const placeholders = accountTables.map(() => '?').join(',');
  const values = [...accountTables];
  const tables = await rows(connection, `SELECT TABLE_NAME AS tableName, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`, values);
  const columns = await rows(connection, `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, EXTRA AS extra, COLLATION_NAME AS collation, GENERATION_EXPRESSION AS generationExpression, CHARACTER_MAXIMUM_LENGTH AS maximumLength FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`, values);
  const indexes = await rows(connection, `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName, SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`, values);
  const foreignKeys = await rows(connection, `SELECT k.TABLE_NAME AS tableName, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.DELETE_RULE AS deleteRule, r.UPDATE_RULE AS updateRule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME IN (${placeholders})`, values);
  const checks = await rows(connection, `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, ENFORCED AS enforced FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK' AND TABLE_NAME IN (${placeholders})`, values);
  issues.push(...inspectMetadata({ tables, columns, indexes, foreignKeys, checks }));
  const present = new Set(columns.map(column => `${column.tableName}.${column.columnName}`));
  const dataChecks = [
    ['invalid_ids', 'users', ['id'], 'SELECT COUNT(*) AS count FROM users WHERE id IS NULL OR id < 1'],
    ['duplicate_user_ids', 'users', ['id'], 'SELECT COUNT(*) AS count FROM (SELECT id FROM users GROUP BY id HAVING COUNT(*) > 1) AS duplicate_groups'],
    ['email_not_normalized', 'users', ['email'], "SELECT COUNT(*) AS count FROM users WHERE email IS NOT NULL AND (email = '' OR CAST(email AS BINARY) <> CAST(LOWER(TRIM(email)) AS BINARY))"],
    ['duplicate_normalized_emails', 'users', ['email'], "SELECT COUNT(*) AS count FROM (SELECT CONVERT(LOWER(TRIM(email)) USING utf8mb4) COLLATE utf8mb4_0900_as_ci AS identity_key FROM users WHERE email IS NOT NULL AND TRIM(email) <> '' GROUP BY identity_key HAVING COUNT(*) > 1) AS duplicate_groups"],
    ['backup_email_not_normalized', 'users', ['backup_email'], "SELECT COUNT(*) AS count FROM users WHERE backup_email IS NOT NULL AND (backup_email = '' OR CAST(backup_email AS BINARY) <> CAST(LOWER(TRIM(backup_email)) AS BINARY))"],
    ['phone_country_missing', 'users', ['phone', 'phone_country_code'], "SELECT COUNT(*) AS count FROM users WHERE phone IS NOT NULL AND (TRIM(phone) = '' OR phone_country_code IS NULL OR TRIM(phone_country_code) = '')"],
    ['duplicate_normalized_phones', 'users', ['phone', 'phone_country_code'], "SELECT COUNT(*) AS count FROM (SELECT CAST(TRIM(phone_country_code) AS BINARY), CAST(TRIM(phone) AS BINARY) FROM users WHERE phone IS NOT NULL GROUP BY CAST(TRIM(phone_country_code) AS BINARY), CAST(TRIM(phone) AS BINARY) HAVING COUNT(*) > 1) AS duplicate_groups"],
    ['invalid_auth_version', 'users', ['auth_version'], 'SELECT COUNT(*) AS count FROM users WHERE auth_version IS NULL OR auth_version < 0'],
    ['invalid_required_user_fields', 'users', ['status', 'created_at', 'updated_at'], 'SELECT COUNT(*) AS count FROM users WHERE status IS NULL OR created_at IS NULL OR updated_at IS NULL'],
    ['duplicate_pending_deletions', 'account_deletion_requests', ['user_id', 'status'], 'SELECT COUNT(*) AS count FROM (SELECT user_id FROM account_deletion_requests WHERE status = 0 GROUP BY user_id HAVING COUNT(*) > 1) AS duplicate_groups'],
  ];
  for (const identity of ['google_sub', 'apple_sub']) {
    dataChecks.push([`${identity}_not_normalized`, 'users', [identity], `SELECT COUNT(*) AS count FROM users WHERE ${identity} IS NOT NULL AND (${identity} = '' OR CAST(${identity} AS BINARY) <> CAST(TRIM(${identity}) AS BINARY))`],
      [`duplicate_${identity}`, 'users', [identity], `SELECT COUNT(*) AS count FROM (SELECT CAST(TRIM(${identity}) AS BINARY) AS identity_key FROM users WHERE ${identity} IS NOT NULL AND TRIM(${identity}) <> '' GROUP BY identity_key HAVING COUNT(*) > 1) AS duplicate_groups`]);
  }
  if (scanData) {
    for (const [code, table, required, statement] of dataChecks) if (required.every(column => present.has(`${table}.${column}`))) {
      const amount = await count(connection, statement);
      if (amount !== '0') issues.push(issue(code, table, { count: amount }));
    }
    if (present.has('users.id')) for (const name of ['user_profiles', 'account_deletion_requests', 'account_restrictions']) if (present.has(`${name}.user_id`)) {
      const amount = await count(connection, `SELECT COUNT(*) AS count FROM ${name} c LEFT JOIN users u ON u.id = c.user_id WHERE u.id IS NULL`);
      if (amount !== '0') issues.push(issue('orphan_user_reference', name, { count: amount }));
    }
  }
  return { ok: issues.length === 0, scope: 'account-mysql-read-only', issues, dataScanned: scanData };
}

module.exports = { auditAccountSchema, inspectMetadata, supportedMySql, accountTables, expectedColumns, requiredIndexes };

if (require.main === module) {
  (async () => {
    let connection;
    try {
      const { createRequire } = require('node:module');
      const path = require('node:path');
      const driver = createRequire(path.resolve(__dirname, '../../api/package.json'))('mysql2/promise');
      const database = process.env.MYSQL_DATABASE || process.env.DB_NAME;
      const user = process.env.MYSQL_USER || process.env.DB_USER;
      if (!database || !user) throw new Error('audit_database_configuration_required');
      connection = await driver.createConnection({
        host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
        user, database, password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD,
        supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false,
        connectTimeout: 10000,
      });
      const result = await auditAccountSchema(connection);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } catch {
      console.error('Account database audit failed. Check the configured database, read-only access and schema; no migration was attempted.');
      process.exitCode = 2;
    } finally { await connection?.end(); }
  })();
}
