CREATE TABLE IF NOT EXISTS tasks (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  date_created   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_processed DATETIME      NULL,
  metadata       JSON          NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (id),
  INDEX idx_date_processed (date_processed)
)
