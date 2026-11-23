-- Base D1 « gospel-usage » : un événement par ligne.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member TEXT NOT NULL,          -- identifiant du membre (ex. misa)
  type TEXT NOT NULL,            -- open (ouverture) | login (connexion par mot de passe) | activate (première connexion sur un appareil)
  ts INTEGER NOT NULL,           -- date de l'événement, en millisecondes
  os TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  standalone INTEGER NOT NULL DEFAULT 0,  -- 1 = app installée, 0 = navigateur
  ver TEXT NOT NULL DEFAULT '',
  UNIQUE (member, type, ts)      -- un renvoi après coupure réseau ne crée pas de doublon
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_member ON events (member, type, ts);
