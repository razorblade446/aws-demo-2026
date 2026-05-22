ALTER TABLE kafka_tasks
  CHANGE COLUMN shipping_company shipper  VARCHAR(50)   NOT NULL,
  ADD    COLUMN product                   VARCHAR(100)  NOT NULL DEFAULT '' AFTER shipper,
  ADD    COLUMN qty                       INT UNSIGNED  NOT NULL DEFAULT 1  AFTER product,
  ADD    COLUMN status                    VARCHAR(20)   NOT NULL DEFAULT 'pending' AFTER qty,
  DROP   COLUMN metadata,
  ADD    INDEX  idx_status (status);
