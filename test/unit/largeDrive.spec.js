import { expect } from "chai";
import sinon from "sinon";
import { GoogleDriveClient } from "../../dist/index.js";

const FOLDER = "application/vnd.google-apps.folder";

function driveItem(id, name, parents, isFolder = false) {
    return {
        id,
        name,
        mimeType: isFolder ? FOLDER : "application/octet-stream",
        createdTime: "2024-01-01T00:00:00.000Z",
        modifiedTime: "2024-01-02T00:00:00.000Z",
        shared: false,
        size: isFolder ? undefined : "10",
        parents
    };
}

function clientFor(files) {
    const client = new GoogleDriveClient("token");
    client.patcher.patch("request", () =>
        Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            json: () => Promise.resolve({ files })
        })
    );
    return client;
}

// /Vaults, /Vaults/Work, /Vaults/Work/Old, an empty /Vaults/Empty; one file in two folders
const NESTED = [
    driveItem("f-old", "Old", ["f-work"], true),
    driveItem("v-1", "work.bcup", ["f-work"]),
    driveItem("f-work", "Work", ["f-vaults"], true),
    driveItem("v-2", "both.bcup", ["f-old", "f-vaults"]),
    driveItem("f-vaults", "Vaults", ["my-drive"], true),
    driveItem("v-3", "top.bcup", ["my-drive"]),
    driveItem("f-empty", "Empty", ["f-vaults"], true),
    driveItem("v-4", "orphan.bcup", [])
];

describe("large and nested drives", function () {
    describe("getDirectoryContents", function () {
        it("builds nested folders, listing a multi-parent file under each parent", async function () {
            const tree = await clientFor(NESTED).getDirectoryContents();
            expect(tree.files.map(f => f.filename)).to.deep.equal(["top.bcup", "orphan.bcup"]);
            expect(tree.children.map(c => c.filename)).to.deep.equal(["Vaults"]);
            const [vaults] = tree.children;
            expect(vaults.files.map(f => f.filename)).to.deep.equal(["both.bcup"]);
            expect(vaults.children.map(c => c.filename)).to.deep.equal(["Work", "Empty"]);
            const [work, empty] = vaults.children;
            expect(empty.files).to.deep.equal([]);
            expect(empty.children).to.deep.equal([]);
            expect(work.files.map(f => f.filename)).to.deep.equal(["work.bcup"]);
            const [old] = work.children;
            expect(old.filename).to.equal("Old");
            expect(old.files.map(f => f.filename)).to.deep.equal(["both.bcup"]);
            expect(old.children).to.deep.equal([]);
        });

        it("follows nextPageToken and joins the pages", async function () {
            const client = new GoogleDriveClient("token");
            const pages = {
                "": { files: NESTED.slice(0, 4), nextPageToken: "page-2" },
                "page-2": { files: NESTED.slice(4) }
            };
            const request = sinon.spy(config =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    statusText: "OK",
                    json: () => Promise.resolve(pages[config.query.pageToken || ""])
                })
            );
            client.patcher.patch("request", request);
            const files = await client.getDirectoryContents(false);
            expect(request.callCount).to.equal(2);
            expect(request.firstCall.args[0].query).to.not.have.property("pageToken");
            expect(request.secondCall.args[0].query).to.have.property("pageToken", "page-2");
            expect(files.map(f => f.id)).to.deep.equal(NESTED.map(f => f.id));
        });
    });

    describe("mapDirectoryContents", function () {
        it("resolves paths several folders deep", async function () {
            const client = clientFor(NESTED);
            const old = await client.mapDirectoryContents("/Vaults/Work/Old/");
            expect(old.map(i => [i.filename, i.dirPath])).to.deep.equal([
                ["both.bcup", "/Vaults/Work/Old"]
            ]);
            const work = await client.mapDirectoryContents("/Vaults/Work");
            expect(work.map(i => i.filename)).to.deep.equal(["Old", "work.bcup"]);
            const root = await client.mapDirectoryContents("/");
            expect(root.map(i => i.filename)).to.deep.equal(["Vaults", "top.bcup", "orphan.bcup"]);
        });

        it("fetches the listing again once the cached copy is 10 seconds old", async function () {
            const clock = sinon.useFakeTimers({ now: 1000000, toFake: ["Date"] });
            try {
                const client = clientFor(NESTED);
                sinon.spy(client.patcher, "execute");
                await client.mapDirectoryContents("/");
                clock.tick(5000);
                await client.mapDirectoryContents("/Vaults");
                expect(client.patcher.execute.callCount).to.equal(1);
                clock.tick(6000);
                const res = await client.mapDirectoryContents("/Vaults");
                expect(client.patcher.execute.callCount).to.equal(2);
                expect(res.map(i => i.filename)).to.deep.equal(["Work", "Empty"]);
            } finally {
                clock.restore();
            }
        });

        it("lists a folder of a 30,000 item drive quickly", async function () {
            this.timeout(10000);
            const files = [];
            for (let i = 0; i < 3000; i += 1) {
                files.push(
                    driveItem(`f${i}`, `Folder ${i}`, [i < 10 ? "root" : `f${i % 10}`], true)
                );
            }
            for (let i = 0; i < 27000; i += 1) {
                files.push(driveItem(`v${i}`, `Vault ${i}.bcup`, [`f${i % 3000}`]));
            }
            const client = clientFor(files);
            const start = Date.now();
            const res = await client.mapDirectoryContents("/Folder 3/Folder 13");
            const tree = await client.getDirectoryContents();
            // Quadratic lookups took several seconds here
            expect(Date.now() - start).to.be.below(1000);
            expect(res.map(i => i.filename)).to.deep.equal([
                "Vault 13.bcup",
                "Vault 3013.bcup",
                "Vault 6013.bcup",
                "Vault 9013.bcup",
                "Vault 12013.bcup",
                "Vault 15013.bcup",
                "Vault 18013.bcup",
                "Vault 21013.bcup",
                "Vault 24013.bcup"
            ]);
            expect(tree.children).to.have.lengthOf(10);
        });
    });
});
