DROP TABLE change;
DROP TABLE build;

CREATE TABLE change (
       changeset CHAR(40) UNIQUE,
       pull_request INTEGER,
       time INTEGER
);

CREATE TABLE build (
       change_id INTEGER,
       build_num INTEGER,
       plat TEXT,
       compile_time INTEGER,
       test_time INTEGER
);

CREATE INDEX build_plat ON build (plat);
