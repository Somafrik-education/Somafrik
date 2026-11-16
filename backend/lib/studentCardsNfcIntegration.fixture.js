"use strict";

// Test infrastructure only. Full production repository/HTTP routes, disposable
// local PostgreSQL database, synthetic identities, no deployed service access.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const { resolve } = require("node:path");
const { Pool } = require("pg");
const { mintSessionAccessToken } = require("./testAccessSession");

function reserveLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

/** True when `pid` holds a listening socket on `port` (IPv4 or IPv6). */
function listenPortOwnedBy(pid, port) {
  const hexPort = Number(port).toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const local = parts[1];
      const state = parts[3];
      const inode = parts[9];
      if (state !== "0A") continue;
      if (String(local.split(":").pop()).toUpperCase() !== hexPort) continue;
      inodes.add(inode);
    }
  }
  if (!inodes.size) return false;
  let fds = [];
  try {
    fds = fs.readdirSync(`/proc/${pid}/fd`);
  } catch {
    return false;
  }
  for (const fd of fds) {
    try {
      const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
      const match = /^socket:\[(\d+)\]$/.exec(link);
      if (match && inodes.has(match[1])) return true;
    } catch {
      /* descripteur disparu */
    }
  }
  return false;
}

async function waitForOwnedHealth(child, port) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) return "lost";
    if (listenPortOwnedBy(child.pid, port)) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok && child.exitCode == null && listenPortOwnedBy(child.pid, port)) return "ready";
      } catch {
        /* le processus écoute, la route santé n'a pas encore répondu */
      }
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (child.exitCode == null) child.kill("SIGTERM");
  return "lost";
}

async function createIntegrationFixture() {
  const input = process.env.SOMAFRIK_NFC_TEST_DATABASE_URL;
  assert.ok(
    input,
    "SOMAFRIK_NFC_TEST_DATABASE_URL is mandatory; no silent skip",
  );
  const url = new URL(input);
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "Local disposable PostgreSQL only",
  );
  assert.match(url.pathname, /^\/(nfc_encoding_test|nfc_prog_02_test)$/);
  const database = `nfc_prog_05_${randomUUID().replace(/-/g, "")}`;
  url.pathname = "/postgres";
  const admin = new Pool({ connectionString: url.toString() });
  // DROP DATABASE … FORCE termine les autres sessions. Sans écouteur, pg
  // émet « terminating connection due to administrator command » hors test.
  const ignorePoolError = () => {};
  admin.on("error", ignorePoolError);
  await admin.query(`CREATE DATABASE ${database}`);
  url.pathname = `/${database}`;
  const connectionString = url.toString();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const { createPostgresRepository } = require("../db/repositoryFactory");
  const { TokenService } = require("../services/tokenService");
  const repo = createPostgresRepository(connectionString);
  const pool = new Pool({ connectionString });
  pool.on("error", ignorePoolError);
  if (repo.pool && typeof repo.pool.on === "function") repo.pool.on("error", ignorePoolError);
  const jwtSecret = "nfc-integration-fixture-local-test-only-not-production";
  const tokens = new TokenService({ secret: jwtSecret });
  let child = null;
  let logs = "";
  let port = 0;
  async function close() {
    if (child && child.exitCode == null) {
      await new Promise((done) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          done();
        });
        child.kill("SIGTERM");
      });
    }
    await pool.end();
    if (typeof repo.close === "function") await repo.close();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
  try {
    await repo.init();
    const country = (
      await pool.query(
        "INSERT INTO countries(name,iso_code,phone_code,currency) VALUES('NFC Fixture','CD','+243','CDF') RETURNING id",
      )
    ).rows[0].id;
    const schools = [];
    for (let i = 1; i <= 2; i++) {
      const code = `CD-NFC-26-00${i}`;
      const school = (
        await pool.query(
          "INSERT INTO schools(country_id,school_code,login_code,short_code,name,status) VALUES($1,$2::text,$2::text,'NFC',$3,'active') RETURNING id",
          [country, code, `Fixture ${i}`],
        )
      ).rows[0].id;
      const user = randomUUID();
      await pool.query(
        "INSERT INTO users(id,school_id,user_code,first_name,last_name,email,role,status,must_change_password) VALUES($1,$2,$3,'NFC','Admin',$4,'Admin School','active',FALSE)",
        [user, school, `NFC-ADM-${i}`, `admin${i}@nfc.fixture.test`],
      );
      await pool.query(
        "INSERT INTO user_roles(user_id,school_id,role_key,status) VALUES($1,$2,'SCHOOL_ADMIN','active')",
        [user, school],
      );
      await pool.query(
        "INSERT INTO school_settings(school_id,student_card_enabled,student_card_nfc_enabled) VALUES($1,TRUE,TRUE) ON CONFLICT(school_id) DO UPDATE SET student_card_enabled=TRUE,student_card_nfc_enabled=TRUE",
        [school],
      );
      // CARTE-CYCLE-01 : titulaire explicite (élève) pour les établissements de test émetteurs de cartes.
      await pool.query("UPDATE school_settings SET student_card_holder_kind = 'eleve' WHERE school_id = $1", [school]);
      const year = (
        await pool.query(
          "INSERT INTO academic_years(school_id,name,is_current,status) VALUES($1,'2026-2027',TRUE,'open') RETURNING id",
          [school],
        )
      ).rows[0].id;
      const token = await mintSessionAccessToken({ tokens, repository: repo, payload: {
        sub: user,
        role: "Admin School",
        roleKeys: ["SCHOOL_ADMIN"],
        schoolCode: code,
        mustChangePassword: false,
        permissions: [
          "Élèves:READ",
          "Élèves:UPDATE",
          "Classes:READ",
          "Voir élèves",
          "Gérer élèves",
        ],
      } });
      schools.push({ id: school, code, user, year, token });
    }
    const extraTokens = {};
    for (const [key, role, roleKey, schoolIndex, permissions] of [
      ["teacher", "Enseignant", "TEACHER", 0, ["Élèves:READ"]],
      [
        "super",
        "Super Administrateur Somafrik",
        "SUPER_ADMIN",
        null,
        ["ALL_PRIVILEGES", "Élèves:READ", "Élèves:UPDATE"],
      ],
      [
        "country",
        "Admin Pays",
        "COUNTRY_ADMIN",
        null,
        ["COUNTRY_PRIVILEGES", "Élèves:READ", "Élèves:UPDATE"],
      ],
    ]) {
      const id = randomUUID(),
        schoolId = schoolIndex == null ? null : schools[schoolIndex].id;
      await pool.query(
        "INSERT INTO users(id,school_id,user_code,first_name,last_name,email,role,status,must_change_password) VALUES($1,$2,$3,'NFC','Role',$4,$5,'active',FALSE)",
        [id, schoolId, `NFC-${key}`, `${key}@nfc.fixture.test`, role],
      );
      await pool.query(
        "INSERT INTO user_roles(user_id,school_id,role_key,status) VALUES($1,$2,$3,'active')",
        [id, schoolId, roleKey],
      );
      extraTokens[key] = await mintSessionAccessToken({ tokens, repository: repo, payload: {
        sub: id,
        role,
        roleKeys: [roleKey],
        schoolCode: schools[0].code,
        countryCode: "CD",
        mustChangePassword: false,
        permissions,
      } });
    }
    let owned = "lost";
    let lastLogs = "";
    for (let attempt = 1; attempt <= 5 && owned !== "ready"; attempt += 1) {
      if (child && child.exitCode == null) child.kill("SIGKILL");
      port = await reserveLoopbackPort();
      const bucket = { text: "" };
      child = spawn(process.execPath, ["backend/server.js"], {
        cwd: resolve(__dirname, "../.."),
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: String(port),
          DATABASE_URL: connectionString,
          JWT_SECRET: jwtSecret,
          SOMAFRIK_DB_REQUIRED: "true",
          SOMAFRIK_SKIP_DEMO_SEED: "true",
          SOMAFRIK_API_ONLY: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => {
        bucket.text += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        bucket.text += String(chunk);
      });
      owned = await waitForOwnedHealth(child, port);
      logs = bucket.text;
      lastLogs = bucket.text;
    }
    assert.equal(
      owned,
      "ready",
      `Fixture Backend is not listening on its own port ${port}.\n${lastLogs}`,
    );
    assert.equal(listenPortOwnedBy(child.pid, port), true);
    async function request(path, options = {}, token = schools[0].token) {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
      });
      const data = await response.json();
      return {
        status: response.status,
        data,
        cacheControl: response.headers.get("cache-control"),
      };
    }
    let sequence = 0;
    async function cohort(count, school = schools[0]) {
      sequence++;
      const classCode = `NFC-CLASS-${sequence}`;
      const classId = (
        await pool.query(
          "INSERT INTO classes(school_id,academic_year_id,class_code,name,status) VALUES($1,$2,$3,$4,'active') RETURNING id",
          [school.id, school.year, classCode, `Fixture classe ${sequence}`],
        )
      ).rows[0].id;
      const students = [];
      for (let i = 0; i < count; i++) {
        const id = randomUUID();
        await pool.query(
          "INSERT INTO students(id,school_id,first_name,last_name,status) VALUES($1,$2,'Élève',$3,'active')",
          [id, school.id, String(i).padStart(3, "0")],
        );
        await pool.query(
          "INSERT INTO enrollments(school_id,student_id,class_id,academic_year_id,status) VALUES($1,$2,$3,$4,'ENROLLED')",
          [school.id, id, classId, school.year],
        );
        students.push(id);
      }
      return { school, classId, classCode, students };
    }
    return {
      pool,
      repo,
      port,
      pid: child.pid,
      schools,
      extraTokens,
      request,
      cohort,
      // Jeton signé avec le secret local de la fixture (identités synthétiques uniquement).
      // SEC-AUTH-04 : jeton lié à une session réelle du sujet (asynchrone).
      mint: (claims) => mintSessionAccessToken({ tokens, repository: repo, payload: claims }),
      // Secret local de la fixture (jamais un secret d'environnement réel) : signer un défi de test.
      jwtSecret,
      logs: () => logs,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { createIntegrationFixture, listenPortOwnedBy };
