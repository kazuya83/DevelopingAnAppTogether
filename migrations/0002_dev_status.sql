-- Issue になった後の開発の進み具合（GitHub の Issue から 5 分ごとに取り込む）
--   waiting: 開発待ち / developing: 開発中 / review: 確認中（PR 作成済み） / pending: 保留（管理者が確認中）
--   released: 反映済み / declined: 見送り
ALTER TABLE proposals ADD COLUMN dev_status TEXT;
ALTER TABLE proposals ADD COLUMN dev_status_at INTEGER;
UPDATE proposals SET dev_status = 'waiting', dev_status_at = issued_at WHERE status = 'issued';
