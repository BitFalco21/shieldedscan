/**
 * Advisory-lock key for setting up `opendata_reader` in a test database. The role and its
 * settings are cluster-wide, so two suites configuring it at once collide in pg_db_role_setting.
 */
export const OPENDATA_ROLE_LOCK = 0x6f70656e;
