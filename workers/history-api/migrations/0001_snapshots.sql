CREATE TABLE IF NOT EXISTS snapshots (
  cardId TEXT NOT NULL,
  date TEXT NOT NULL,
  trend REAL,
  low REAL,
  avg30 REAL,
  avg7 REAL,
  avg1 REAL,
  PRIMARY KEY (cardId, date)
);

CREATE INDEX IF NOT EXISTS idx_card_date ON snapshots(cardId, date DESC);
CREATE INDEX IF NOT EXISTS idx_date ON snapshots(date DESC);
