'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { auditAccountSchema, inspectMetadata, supportedMySql, accountTables, expectedColumns, requiredIndexes } = require('../backend/sql/account/audit-schema.cjs');

function reviewedMetadata() {
  const lengths = { email: 320, backup_email: 320, phone: 30, password: 255, nickname: 100, avatar_url: 1024,
    google_sub: 255, apple_sub: 255, phone_country_code: 10, last_login_ip: 45, reason: 500, restriction_type: 30 };
  const tables = accountTables.map(tableName => ({ tableName, engine: 'InnoDB', collation: 'utf8mb4_0900_as_ci' }));
  const columns = Object.entries(expectedColumns).flatMap(([tableName, fields]) => fields.map(columnName => {
    const id = ['id', 'user_id', 'auth_version'].includes(columnName);
    return { tableName, columnName, columnType: id ? 'bigint unsigned' : `varchar(${lengths[columnName] ?? 100})`,
      maximumLength: lengths[columnName] ?? 100, nullable: id ? 'NO' : 'YES',
      extra: columnName === 'id' ? 'auto_increment' : columnName === 'pending_user_id' ? 'STORED GENERATED' : '',
      generationExpression: columnName === 'pending_user_id' ? '(case when (`status` = 0) then `user_id` else NULL end)' : '',
      collation: ['google_sub', 'apple_sub'].includes(columnName) ? 'utf8mb4_0900_bin' : 'utf8mb4_0900_as_ci' };
  }));
  const indexes = Object.entries(requiredIndexes).flatMap(([tableName, keys]) => keys.flatMap((key, index) => key.map((columnName, offset) => ({
    tableName, indexName: index === 0 ? 'PRIMARY' : `key_${index}`, nonUnique: 0, sequence: offset + 1, columnName, prefixLength: null,
  }))));
  const foreignKeys = ['user_profiles', 'account_deletion_requests', 'account_restrictions'].map(tableName => ({ tableName, columnName: 'user_id', referencedTable: 'users', referencedColumn: 'id', deleteRule: 'RESTRICT', updateRule: 'RESTRICT' }));
  const checks = Object.entries({
    users: ['ck_users_email_normalized', 'ck_users_backup_email_normalized', 'ck_users_phone_country', 'ck_users_google_sub', 'ck_users_apple_sub'],
    user_profiles: ['ck_user_profiles_gender', 'ck_user_profiles_longitude', 'ck_user_profiles_latitude'],
    account_deletion_requests: ['ck_deletion_status'], account_restrictions: ['ck_restriction_type', 'ck_restriction_status', 'ck_restriction_expiry'],
  }).flatMap(([tableName, names]) => names.map(constraintName => ({ tableName, constraintName, enforced: 'YES' })));
  return { tables, columns, indexes, foreignKeys, checks };
}
function fixture(options = {}) {
  const metadata = options.metadata ?? reviewedMetadata();
  const queries = [];
  return { queries, async execute(sql, values) {
    queries.push({ sql, values });
    assert.match(sql, /^SELECT\b/i);
    assert.match(sql, /MAX_EXECUTION_TIME\(15000\)/);
    assert.doesNotMatch(sql, /;|\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|OUTFILE|DUMPFILE)\b/i);
    if (sql.includes('VERSION()')) return [[{ version: options.version ?? '8.4.6', sqlMode: options.sqlMode ?? 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION' }]];
    if (sql.includes('information_schema.TABLES ')) return [metadata.tables];
    if (sql.includes('information_schema.COLUMNS ')) return [metadata.columns];
    if (sql.includes('information_schema.STATISTICS ')) return [metadata.indexes];
    if (sql.includes('information_schema.KEY_COLUMN_USAGE ')) return [metadata.foreignKeys];
    if (sql.includes('information_schema.TABLE_CONSTRAINTS ')) return [metadata.checks];
    assert.match(sql, /COUNT\(\*\) AS count/);
    const failure = options.counts?.find(([pattern]) => pattern.test(sql));
    return [[{ count: failure?.[1] ?? '0', email: 'must-not-print@example.test', phone: '+15555550123', password: 'must-not-print-secret' }]];
  } };
}

test('account MySQL schema is separate, additive initialization without execution or seed data', () => {
  const filename = path.join(__dirname, '../backend/sql/account/0000_account_schema.mysql.sql');
  const sql = readFileSync(filename, 'utf8').replace(/--[^\n]*/g, '');
  assert.equal((sql.match(/CREATE TABLE /g) ?? []).length, 4);
  assert.doesNotMatch(sql, /(?:^|;)\s*(?:USE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(sql, /IF NOT EXISTS|FOREIGN_KEY_CHECKS|id就用/);
  assert.match(sql, /id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT/);
  assert.match(sql, /auth_version BIGINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(sql, /UNIQUE KEY uq_users_phone \(phone_country_code, phone\)/);
  for (const name of ['email', 'google_sub', 'apple_sub']) assert.match(sql, new RegExp(`UNIQUE KEY uq_users_${name} \\(${name}\\)`));
  assert.equal((sql.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length, 3);
  assert.match(sql, /pending_user_id BIGINT UNSIGNED GENERATED ALWAYS AS/);
  assert.match(sql, /UNIQUE KEY uq_deletion_pending_user \(pending_user_id\)/);
  for (const column of ['birth_longitude', 'birth_latitude', 'default_cast_method']) assert.match(sql, new RegExp(`\\b${column}\\b`));
  const journal = readFileSync(path.join(__dirname, '../backend/sql/meta/_journal.json'), 'utf8');
  assert.doesNotMatch(journal, /account_schema|sql\/account/);
});

test('accept only the reviewed MySQL family/version without opening a connection', () => {
  for (const version of ['8.0.21', '8.0.44-commercial', '8.4.6', '9.0.0']) assert.equal(supportedMySql(version), true, version);
  for (const version of ['8.0.20', '5.7.44', '10.11.9-MariaDB', '8.0.35-MariaDB', '', 'not-a-version']) assert.equal(supportedMySql(version), false, version);
});

test('reviewed metadata passes structural checks, including precise identity indexes', () => {
  assert.deepEqual(inspectMetadata(reviewedMetadata()), []);
});

test('missing original-bundle primary keys and unique indexes are rejected', () => {
  const metadata = reviewedMetadata(); metadata.indexes = [];
  const issues = inspectMetadata(metadata);
  assert.equal(issues.filter(row => row.code === 'primary_key_required').length, 4);
  assert.ok(issues.some(row => row.code === 'missing_full_unique_index' && row.columns.join(',') === 'email'));
  assert.ok(issues.some(row => row.code === 'missing_full_unique_index' && row.columns.join(',') === 'phone_country_code,phone'));
});

test('a partial email prefix or nonunique index is not a sufficient identity constraint', () => {
  for (const bad of [{ prefixLength: 32 }, { nonUnique: 1 }]) {
    const metadata = reviewedMetadata();
    Object.assign(metadata.indexes.find(row => row.tableName === 'users' && row.columnName === 'email'), bad);
    assert.ok(inspectMetadata(metadata).some(row => row.code === 'missing_full_unique_index' && row.columns[0] === 'email'));
  }
});

test('reject a unique key in place of a real primary key, wrong BIGINT, missing auto increment or OAuth collation', () => {
  const metadata = reviewedMetadata();
  metadata.indexes.find(row => row.tableName === 'users' && row.indexName === 'PRIMARY').indexName = 'not_primary';
  metadata.columns.find(row => row.tableName === 'users' && row.columnName === 'id').extra = '';
  metadata.columns.find(row => row.tableName === 'users' && row.columnName === 'auth_version').columnType = 'bigint';
  metadata.columns.find(row => row.tableName === 'users' && row.columnName === 'google_sub').collation = 'utf8mb4_0900_as_ci';
  const codes = inspectMetadata(metadata).map(row => row.code);
  for (const code of ['primary_key_required', 'auto_increment_required', 'unsigned_nonnullable_bigint_required', 'oauth_subject_exact_collation_required']) assert.ok(codes.includes(code), code);
});

test('profile columns missing from original ZIP SQL are mandatory compatibility fields', () => {
  const metadata = reviewedMetadata();
  metadata.columns = metadata.columns.filter(row => !['birth_longitude', 'birth_latitude', 'default_cast_method'].includes(row.columnName));
  const issues = inspectMetadata(metadata);
  for (const column of ['birth_longitude', 'birth_latitude', 'default_cast_method']) assert.ok(issues.some(row => row.code === 'missing_column' && row.column === column));
});

test('reject cascade deletion, disabled checks and an unenforced pending-request generated key', () => {
  const metadata = reviewedMetadata();
  metadata.foreignKeys[0].deleteRule = 'CASCADE';
  metadata.checks[0].enforced = 'NO';
  metadata.columns.find(row => row.columnName === 'pending_user_id').generationExpression = 'user_id';
  const codes = inspectMetadata(metadata).map(row => row.code);
  for (const code of ['restrict_user_foreign_key_required', 'enforced_check_required', 'pending_deletion_generated_expression_required']) assert.ok(codes.includes(code), code);
});

test('too-small columns, optional identity NOT NULL and non-InnoDB tables fail structural review', () => {
  const metadata = reviewedMetadata(); metadata.tables[0].engine = 'MyISAM';
  Object.assign(metadata.columns.find(row => row.tableName === 'users' && row.columnName === 'email'), { maximumLength: 80, nullable: 'NO' });
  const codes = inspectMetadata(metadata).map(row => row.code);
  for (const code of ['engine_must_be_innodb', 'column_capacity_required', 'optional_identity_must_allow_null']) assert.ok(codes.includes(code), code);
});

test('complete audit sends SELECT statements only and never returns account values', async () => {
  const connection = fixture(); const result = await auditAccountSchema(connection);
  assert.equal(result.ok, true); assert.equal(result.dataScanned, true);
  assert.ok(connection.queries.length > 15);
  const output = JSON.stringify(result);
  for (const forbidden of ['must-not-print@example.test', '+15555550123', 'must-not-print-secret']) assert.ok(!output.includes(forbidden));
  assert.ok(connection.queries.filter(row => row.sql.includes('information_schema.')).every(row => JSON.stringify(row.values) === JSON.stringify(accountTables)));
});

test('duplicate IDs/identities and orphan references appear only as aggregate problems', async () => {
  const connection = fixture({ counts: [[/GROUP BY id HAVING/, '2'], [/GROUP BY identity_key HAVING/, '3'], [/LEFT JOIN users/, '1']] });
  const result = await auditAccountSchema(connection);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'duplicate_user_ids' && row.count === '2'));
  assert.ok(result.issues.some(row => row.code === 'duplicate_normalized_emails' && row.count === '3'));
  assert.equal(result.issues.filter(row => row.code === 'orphan_user_reference').length, 3);
  assert.doesNotMatch(JSON.stringify(result), /must-not-print|15555550123/);
});

test('unsupported dialect stops before data or metadata scans', async () => {
  const connection = fixture({ version: '10.11.6-MariaDB' });
  const result = await auditAccountSchema(connection);
  assert.equal(result.ok, false); assert.equal(result.dataScanned, false); assert.equal(connection.queries.length, 1);
});

test('metadata-only audit makes no data table reads; missing schema is not auto-created', async () => {
  const connection = fixture({ metadata: { tables: [], columns: [], indexes: [], foreignKeys: [], checks: [] } });
  const result = await auditAccountSchema(connection, { scanData: false });
  assert.equal(result.ok, false); assert.equal(result.dataScanned, false);
  assert.equal(result.issues.filter(row => row.code === 'missing_table').length, 4);
  assert.equal(connection.queries.length, 6);
});

test('lack of strict mode and malformed driver counts fail closed', async () => {
  const loose = await auditAccountSchema(fixture({ sqlMode: 'NO_ENGINE_SUBSTITUTION' }), { scanData: false });
  assert.ok(loose.issues.some(row => row.code === 'strict_sql_mode_required'));
  await assert.rejects(auditAccountSchema(fixture({ counts: [[/COUNT\(\*\)/, '-1']] })), /audit_invalid_count/);
});
