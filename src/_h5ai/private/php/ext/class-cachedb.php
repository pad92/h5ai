<?php

class CacheDB {
    private ?SQLite3 $conn = null;
    private ?SQLite3Stmt $sel_stmt = null;
    private ?SQLite3Stmt $ins_stmt = null;
    private int $version;

    public function __construct(private readonly Setup $setup) {
        $this->create($setup->get('CACHE_PRV_PATH') . '/thumbs_cache.db');
        $this->setup_version();
    }

    public function __destruct() {
        $this->conn?->close();
    }

    public function create(string $path): void {
        if (!extension_loaded('sqlite3')) {
            return;
        }
        $is_new = !file_exists($path);
        $db = new SQLite3($path);
        $db->exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;');

        if ($is_new) {
            $db->exec('CREATE TABLE types (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, type TEXT UNIQUE);');

            foreach (Thumb::HANDLED_TYPES as $array) {
                foreach ($array as $type) {
                    $db->exec("INSERT OR IGNORE INTO types VALUES (NULL, '{$type}');");
                }
            }

            $db->exec('CREATE TABLE archives
 (hashedp TEXT NOT NULL UNIQUE PRIMARY KEY,
 typeid INTEGER, error INTEGER, ver INTEGER, tstamp INTEGER,
 FOREIGN KEY(typeid) REFERENCES types(id)) WITHOUT ROWID;');
        }

        $this->conn = $db;
    }

    public function insert(string $hash, string $type, ?int $error = null): void {
        if (!$this->conn) {
            return;
        }
        $this->ins_stmt ??= $this->conn->prepare(
            'INSERT OR REPLACE INTO archives VALUES (:id, :typeid, :err, :ver, :time);');

        $stmt = $this->ins_stmt;
        $stmt->reset();

        $stmt->bindValue(':id', $hash, SQLITE3_TEXT);

        $escaped_type = SQLite3::escapeString($type);
        $typeid = $this->conn->querySingle(
            "SELECT id FROM types WHERE type = '{$escaped_type}';");
        if (!$typeid) {
            $this->conn->exec(
                "INSERT INTO types VALUES (NULL, '{$escaped_type}');");
            $typeid = $this->conn->querySingle(
                "SELECT id FROM types WHERE type = '{$escaped_type}';");
        }
        $stmt->bindValue(':typeid', $typeid, SQLITE3_INTEGER);
        $stmt->bindValue(':err', $error, SQLITE3_INTEGER);
        $stmt->bindValue(':ver', $this->version, SQLITE3_INTEGER);
        $stmt->bindValue(':time', time(), SQLITE3_INTEGER);
        $stmt->execute();
    }

    public function select(string $hash): ?array {
        if (!$this->conn) {
            return [];
        }
        $this->sel_stmt ??= $this->conn->prepare(
            'SELECT archives.ver, archives.tstamp, types.type
 FROM archives, types
 WHERE hashedp = :id
 and archives.typeid = types.id;');

        $stmt = $this->sel_stmt;
        $stmt->reset();

        $stmt->bindValue(':id', $hash, SQLITE3_TEXT);
        $res = $stmt->execute();

        $row = $res->fetchArray(SQLITE3_ASSOC);
        $res->finalize();

        return $row ?: null;
    }

    public function obsolete_entry(array $row, int|false $mtime): bool {
        return ($mtime > $row['tstamp']) || ($this->version !== $row['ver']);
    }

    public function setup_version(): int {
        $hash = 0;
        $hash |= $this->setup->get('HAS_PHP_ZIP') ? 0b0001 : 0;
        $hash |= $this->setup->get('HAS_PHP_RAR') ? 0b0010 : 0;
        $hash |= $this->setup->get('HAS_PHP_FILEINFO') ? 0b0100 : 0;
        $hash |= ($this->setup->get('HAS_CMD_FFMPEG')
               || $this->setup->get('HAS_CMD_AVCONV')) ? 0b1000 : 0;
        $hash |= ($this->setup->get('HAS_CMD_GM')
               || $this->setup->get('HAS_CMD_CONVERT')) ? 0b10000 : 0;
        $this->version = $hash;
        return $hash;
    }
}
