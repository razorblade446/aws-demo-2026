CREATE TABLE IF NOT EXISTS kafka_tasks (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  date_created     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_processed   DATETIME      NULL,
  shipping_company VARCHAR(50)   NOT NULL,
  metadata         JSON          NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (id),
  INDEX idx_kafka_date_processed (date_processed)
)
