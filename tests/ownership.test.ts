import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("database ownership, anonymous denial, reassignment defense, and stale revision protection", async (t) => {
  const db = new PGlite();
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; grant usage on schema auth to authenticated;
      create schema storage;
      create table storage.buckets (
        id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
      );
      create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql immutable as
        $$ select string_to_array($1, '/') $$;
      create table auth.users (id uuid primary key);
      insert into auth.users values ('${a}'), ('${b}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.user_id', true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt', true), ''), '{}')::jsonb $$;`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260917220803_ad_studio_workspace.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260918153841_production_video_pipeline.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(`set role authenticated; set request.user_id = '${a}';`);
    await t.test(
      "an owner can create brand, campaign, and encrypted provider account",
      async () => {
        await db.exec(`insert into public.ad_brands(owner_id,kit) values ('${a}', '{"name":"Fullcourt"}');
        insert into public.ad_campaigns(owner_id,name,plan) values ('${a}', 'Launch', '{}');
        insert into public.ad_provider_accounts(owner_id,provider,encrypted_key) values ('${a}', 'higgsfield-platform', '${"encrypted".repeat(6)}');`);
        for (const table of [
          "ad_brands",
          "ad_campaigns",
          "ad_provider_accounts",
        ])
          assert.equal(
            (await db.query(`select * from public.${table}`)).rows.length,
            1,
          );
      },
    );
    await t.test("production rows stay campaign-owner scoped", async () => {
      await db.exec(`set request.user_id='${a}';
        update public.ad_campaigns set status='approved', budget_cents=1000, production_approved_at=now();
        insert into public.ad_shots(owner_id,campaign_id,variant_id,beat_id,position,spec)
          select '${a}',id,'variant-a','beat-a',0,'{}' from public.ad_campaigns;
        insert into public.ad_generation_jobs(owner_id,campaign_id,shot_id,provider,model,prompt,estimated_cost_cents)
          select '${a}',campaign_id,id,'runway','gen4.5','A product shot',120 from public.ad_shots;
      `);
      assert.equal((await db.query("select * from public.ad_shots")).rows.length, 1);
      assert.equal((await db.query("select * from public.ad_generation_jobs")).rows.length, 1);
      await db.exec(`set request.user_id='${b}';`);
      assert.equal((await db.query("select * from public.ad_shots")).rows.length, 0);
      assert.equal((await db.query("select * from public.ad_generation_jobs")).rows.length, 0);
      await db.exec(`set request.user_id='${a}';`);
    });
    await t.test(
      "owner updates increment revision, stale writes affect no rows",
      async () => {
        const before = await db.query<{ revision: number }>("select revision from public.ad_campaigns");
        const revision = before.rows[0]!.revision;
        const result = await db.query<{ revision: number }>(
          `update public.ad_campaigns set name='Updated' where revision=${revision} returning revision`,
        );
        assert.equal(result.rows[0]?.revision, revision + 1);
        assert.equal(
          (
            await db.query(
              `update public.ad_campaigns set name='Stale' where revision=${revision} returning id`,
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test("owner cannot reassign any record", async () => {
      for (const table of ["ad_brands", "ad_campaigns", "ad_provider_accounts"])
        await assert.rejects(
          db.exec(`update public.${table} set owner_id='${b}'`),
          /row-level security/,
        );
    });
    await t.test(
      "another account cannot read, update, or delete any record",
      async () => {
        await db.exec(`set request.user_id='${b}';`);
        for (const table of [
          "ad_brands",
          "ad_campaigns",
          "ad_provider_accounts",
        ]) {
          assert.equal(
            (await db.query(`select * from public.${table}`)).rows.length,
            0,
          );
          assert.equal(
            (
              await db.query(
                `update public.${table} set revision=10 returning *`,
              )
            ).rows.length,
            0,
          );
          assert.equal(
            (await db.query(`delete from public.${table} returning *`)).rows
              .length,
            0,
          );
        }
        await assert.rejects(
          db.exec(
            `insert into public.ad_campaigns(owner_id,name,plan) values ('${a}','Intruder','{}')`,
          ),
          /row-level security/,
        );
      },
    );
    await t.test(
      "anonymous Supabase users cannot access even their own records",
      async () => {
        await db.exec(
          `set request.user_id='${a}'; set request.jwt='{"is_anonymous":true}';`,
        );
        for (const table of [
          "ad_brands",
          "ad_campaigns",
          "ad_provider_accounts",
          "ad_shots",
          "ad_generation_jobs",
          "ad_generation_outputs",
          "ad_assets",
          "ad_render_jobs",
          "ad_usage_events",
          "ad_creative_metrics",
        ])
          assert.equal(
            (await db.query(`select * from public.${table}`)).rows.length,
            0,
          );
      },
    );
    await t.test("unauthenticated role has no table grants", async () => {
      await db.exec("reset role; set role anon;");
      for (const table of ["ad_brands", "ad_campaigns", "ad_provider_accounts"])
        await assert.rejects(
          db.query(`select * from public.${table}`),
          /permission denied/,
        );
    });
  } finally {
    await db.close();
  }
});
