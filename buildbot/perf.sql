DROP TABLE change;
DROP TABLE build;
DROP INDEX build_plat;
DROP INDEX build_change_id;

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
CREATE INDEX build_change_id ON build (change_id);
