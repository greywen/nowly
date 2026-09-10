//! Composable domain writes: ordinary calls own a transaction, assistant batches
//! nest the same domain functions under one atomic transaction.
use rusqlite::{Connection, Result};
use std::ops::Deref;

pub struct WriteScope<'a> {
    connection: &'a Connection,
    savepoint: Option<String>,
    finished: bool,
}

impl<'a> WriteScope<'a> {
    pub fn new(connection: &'a Connection) -> Result<Self> {
        let savepoint = if connection.is_autocommit() {
            connection.execute_batch("BEGIN IMMEDIATE")?;
            None
        } else {
            let name = format!("nowly_{}", uuid::Uuid::new_v4().simple());
            connection.execute_batch(&format!("SAVEPOINT {name}"))?;
            Some(name)
        };
        Ok(Self {
            connection,
            savepoint,
            finished: false,
        })
    }

    pub fn commit(mut self) -> Result<()> {
        match &self.savepoint {
            Some(name) => self.connection.execute_batch(&format!("RELEASE {name}"))?,
            None => self.connection.execute_batch("COMMIT")?,
        }
        self.finished = true;
        Ok(())
    }
}

impl Deref for WriteScope<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        self.connection
    }
}

impl Drop for WriteScope<'_> {
    fn drop(&mut self) {
        if !self.finished {
            let sql = self.savepoint.as_ref().map_or_else(
                || "ROLLBACK".to_owned(),
                |name| format!("ROLLBACK TO {name}; RELEASE {name}"),
            );
            // A failed COMMIT leaves the transaction open. Drop must attempt
            // rollback even then; never mark completion before COMMIT succeeds.
            let _ = self.connection.execute_batch(&sql);
        }
    }
}

pub trait DomainWrite {
    fn domain_write(&self) -> Result<WriteScope<'_>>;
}

impl DomainWrite for Connection {
    fn domain_write(&self) -> Result<WriteScope<'_>> {
        WriteScope::new(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outer_rollback_reverts_nested_commits() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE items(id INTEGER PRIMARY KEY)")
            .unwrap();
        {
            let outer = WriteScope::new(&db).unwrap();
            let inner = WriteScope::new(&outer).unwrap();
            inner.execute("INSERT INTO items VALUES (1)", []).unwrap();
            inner.commit().unwrap();
        }
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM items", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn nested_failure_preserves_outer_transaction() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE items(id INTEGER PRIMARY KEY)")
            .unwrap();
        let outer = WriteScope::new(&db).unwrap();
        outer.execute("INSERT INTO items VALUES (1)", []).unwrap();
        {
            let inner = WriteScope::new(&outer).unwrap();
            inner.execute("INSERT INTO items VALUES (2)", []).unwrap();
        }
        outer.commit().unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM items", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
