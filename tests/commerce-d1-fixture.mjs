import { transaction } from "./commerce-db-fixture.mjs";

export function createD1Adapter(database) {
  let mutations = 0;
  function prepare(sql, args = []) {
    const execute = () => {
      const statement = database.prepare(sql);
      const rows = statement.all(...args);
      const changes = /^(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql.trim())
        ? Number(database.prepare("SELECT changes() AS changes").get().changes) : 0;
      mutations += changes;
      return { results: rows, success: true, meta: { changes } };
    };
    return {
      bind: (...values) => prepare(sql, values),
      all: async () => execute(),
      run: async () => execute(),
      first: async (column) => {
        const result = execute().results[0] ?? null;
        return column && result ? result[column] : result;
      },
      raw: async () => execute().results.map((row) => Object.values(row)),
      execute,
    };
  }
  return {
    prepare,
    batch: async (statements) => transaction(database, () => statements.map((statement) => statement.execute())),
    mutations: () => mutations,
  };
}
