'use strict';

var fp = require('lodash/fp');
var strapiUtils = require('@strapi/utils');
var common = require('./common.js');
var draftAndPublish = require('./draft-and-publish.js');
var internationalization = require('./internationalization.js');
var components = require('./components.js');
var entries = require('./entries.js');
var params = require('./params.js');
var transformContentTypesToModels = require('../../utils/transform-content-types-to-models.js');
var populate = require('./utils/populate.js');
var query = require('./transform/query.js');
var idTransform = require('./transform/id-transform.js');
var events = require('./events.js');
var unidirectionalRelations = require('./utils/unidirectional-relations.js');
var bidirectionalRelations = require('./utils/bidirectional-relations.js');
var index = require('../entity-validator/index.js');
var firstPublishedAt = require('./first-published-at.js');

const { validators } = strapiUtils.validate;
// we have to typecast to reconcile the differences between validator and database getModel
const getModel = (schema)=>strapi.getModel(schema);
const createContentTypeRepository = (uid, validator = index)=>{
    const contentType = strapi.contentType(uid);
    const hasDraftAndPublish = strapiUtils.contentTypes.hasDraftAndPublish(contentType);
    // Define the validations that should be performed
    const sortValidations = [
        'nonAttributesOperators',
        'dynamicZones',
        'morphRelations'
    ];
    const fieldValidations = [
        'scalarAttributes'
    ];
    const filtersValidations = [
        'nonAttributesOperators',
        'dynamicZones',
        'morphRelations'
    ];
    const populateValidations = {
        sort: sortValidations,
        field: fieldValidations,
        filters: filtersValidations,
        populate: [
            'nonAttributesOperators'
        ]
    };
    const validateParams = async (params)=>{
        const ctx = {
            schema: contentType,
            getModel
        };
        await validators.validateFilters(ctx, params.filters, filtersValidations);
        await validators.validateSort(ctx, params.sort, sortValidations);
        await validators.validateFields(ctx, params.fields, fieldValidations);
        await validators.validatePopulate(ctx, params.populate, populateValidations);
        // Strip lookup from params, it's only used internally
        if (params.lookup) {
            throw new strapiUtils.errors.ValidationError("Invalid params: 'lookup'");
        }
        // TODO: add validate status, locale, pagination
        return params;
    };
    const entries$1 = entries.createEntriesService(uid, validator);
    const eventManager = events.createEventManager(strapi, uid);
    const emitEvent = fp.curry(eventManager.emitEvent);
    async function findMany(params = {}) {
        const query$1 = await strapiUtils.async.pipe(validateParams, draftAndPublish.defaultToDraft, draftAndPublish.statusToLookup(contentType), internationalization.defaultLocale(contentType), internationalization.multiLocaleToLookup(contentType), idTransform.transformParamsDocumentId(uid), query.transformParamsToQuery(uid))(params || {});
        return strapi.db.query(uid).findMany(query$1);
    }
    async function findFirst(params = {}) {
        const query$1 = await strapiUtils.async.pipe(validateParams, draftAndPublish.defaultToDraft, draftAndPublish.statusToLookup(contentType), internationalization.defaultLocale(contentType), internationalization.localeToLookup(contentType), idTransform.transformParamsDocumentId(uid), query.transformParamsToQuery(uid))(params);
        return strapi.db.query(uid).findOne(query$1);
    }
    // TODO: do we really want to add filters on the findOne now that we have findFirst ?
    async function findOne(opts = {}) {
        const { documentId, ...params } = opts;
        const query$1 = await strapiUtils.async.pipe(validateParams, draftAndPublish.defaultToDraft, draftAndPublish.statusToLookup(contentType), internationalization.defaultLocale(contentType), internationalization.localeToLookup(contentType), idTransform.transformParamsDocumentId(uid), query.transformParamsToQuery(uid), (query)=>fp.assoc('where', {
                ...query.where,
                documentId
            }, query))(params);
        return strapi.db.query(uid).findOne(query$1);
    }
    async function deleteDocument(opts = {}) {
        const { documentId, ...params } = opts;
        const query$1 = await strapiUtils.async.pipe(validateParams, fp.omit('status'), internationalization.defaultLocale(contentType), internationalization.multiLocaleToLookup(contentType), query.transformParamsToQuery(uid), (query)=>fp.assoc('where', {
                ...query.where,
                documentId
            }, query))(params);
        if (params.status === 'draft') {
            throw new Error('Cannot delete a draft document');
        }
        const entriesToDelete = await strapi.db.query(uid).findMany(query$1);
        // Delete all matched entries and its components
        const deletedEntries = await strapiUtils.async.map(entriesToDelete, (entryToDelete)=>entries$1.delete(entryToDelete.id));
        entriesToDelete.forEach(emitEvent('entry.delete'));
        return {
            documentId,
            entries: deletedEntries
        };
    }
    async function create(opts = {}) {
        const { documentId, ...params } = opts;
        const queryParams = await strapiUtils.async.pipe(validateParams, draftAndPublish.filterDataPublishedAt, draftAndPublish.setStatusToDraft(contentType), draftAndPublish.statusToData(contentType), internationalization.defaultLocale(contentType), internationalization.localeToData(contentType))(params);
        const doc = await entries$1.create(queryParams);
        emitEvent('entry.create', doc);
        if (hasDraftAndPublish && params.status === 'published') {
            return publish({
                ...params,
                documentId: doc.documentId
            }).then((doc)=>doc.entries[0]);
        }
        return doc;
    }
    async function clone(opts = {}) {
        const { documentId, ...params } = opts;
        const queryParams = await strapiUtils.async.pipe(validateParams, draftAndPublish.filterDataPublishedAt, internationalization.defaultLocale(contentType), internationalization.multiLocaleToLookup(contentType))(params);
        // Get deep populate
        const entriesToClone = await strapi.db.query(uid).findMany({
            where: {
                ...queryParams?.lookup,
                documentId,
                // DP Enabled: Clone drafts
                // DP Disabled: Clone only the existing version (published)
                publishedAt: {
                    $null: hasDraftAndPublish
                }
            },
            populate: populate.getDeepPopulate(uid, {
                relationalFields: [
                    'id'
                ]
            })
        });
        const clonedEntries = await strapiUtils.async.map(entriesToClone, strapiUtils.async.pipe(validateParams, fp.omit([
            'id',
            'createdAt',
            'updatedAt'
        ]), // assign new documentId
        fp.assoc('documentId', transformContentTypesToModels.createDocumentId()), // Merge new data into it
        (data)=>fp.merge(data, queryParams.data), (data)=>entries$1.create({
                ...queryParams,
                data,
                status: 'draft'
            })));
        clonedEntries.forEach(emitEvent('entry.create'));
        return {
            documentId: clonedEntries.at(0)?.documentId,
            entries: clonedEntries
        };
    }
    async function update(opts = {}) {
        const { documentId, ...params$1 } = opts;
        const queryParams = await strapiUtils.async.pipe(validateParams, draftAndPublish.filterDataPublishedAt, firstPublishedAt.filterDataFirstPublishedAt, draftAndPublish.setStatusToDraft(contentType), draftAndPublish.statusToLookup(contentType), draftAndPublish.statusToData(contentType), // Default locale will be set if not provided
        internationalization.defaultLocale(contentType), internationalization.localeToLookup(contentType), internationalization.localeToData(contentType))(params$1);
        const { data, ...restParams } = await idTransform.transformParamsDocumentId(uid, queryParams || {});
        const query$1 = query.transformParamsToQuery(uid, params.pickSelectionParams(restParams || {}));
        // Validation
        // Find if document exists
        const entryToUpdate = await strapi.db.query(uid).findOne({
            ...query$1,
            where: {
                ...queryParams?.lookup,
                ...query$1?.where,
                documentId
            }
        });
        let updatedDraft = null;
        if (entryToUpdate) {
            updatedDraft = await entries$1.update(entryToUpdate, queryParams);
            emitEvent('entry.update', updatedDraft);
        }
        if (!updatedDraft) {
            const documentExists = await strapi.db.query(contentType.uid).findOne({
                where: {
                    documentId
                }
            });
            if (documentExists) {
                const mergedData = await internationalization.copyNonLocalizedFields(contentType, documentId, {
                    ...queryParams.data,
                    documentId
                });
                updatedDraft = await entries$1.create({
                    ...queryParams,
                    data: mergedData
                });
                emitEvent('entry.create', updatedDraft);
            }
        }
        if (hasDraftAndPublish && updatedDraft && params$1.status === 'published') {
            return publish({
                ...params$1,
                documentId
            }).then((doc)=>doc.entries[0]);
        }
        return updatedDraft;
    }
    async function count(params = {}) {
        const query$1 = await strapiUtils.async.pipe(validateParams, draftAndPublish.defaultStatus(contentType), draftAndPublish.statusToLookup(contentType), internationalization.defaultLocale(contentType), internationalization.multiLocaleToLookup(contentType), query.transformParamsToQuery(uid))(params);
        return strapi.db.query(uid).count(query$1);
    }
    async function publish(opts = {}) {
        const { documentId, ...params } = opts;
        const queryParams = await strapiUtils.async.pipe(validateParams, internationalization.defaultLocale(contentType), internationalization.multiLocaleToLookup(contentType))(params);
        const [draftsToPublish, oldPublishedVersions] = await Promise.all([
            strapi.db.query(uid).findMany({
                where: {
                    ...queryParams?.lookup,
                    documentId,
                    publishedAt: null
                },
                // Populate relations, media, compos and dz
                populate: populate.getDeepPopulate(uid, {
                    relationalFields: [
                        'documentId',
                        'locale'
                    ]
                })
            }),
            strapi.db.query(uid).findMany({
                where: {
                    ...queryParams?.lookup,
                    documentId,
                    publishedAt: {
                        $ne: null
                    }
                },
                select: [
                    'id',
                    'locale'
                ]
            })
        ]);
        // Add firstPublishedAt to draft if it doesn't exist
        const updatedDraft = await strapiUtils.async.map(draftsToPublish, (draft)=>firstPublishedAt.addFirstPublishedAtToDraft(draft, entries$1.update, contentType));
        // Update published entry
        let publishedEntries;
        if (oldPublishedVersions.length > 0) {
            // if no data is given, it should be copied from the draft
            if (!params.data) {
                const transformData = (obj1)=>{
                    if (!obj1) return undefined;
                    let changes = {};
                    const staticAttributes = Object.values(strapiUtils.contentTypes.constants);
                    const { attributes: schema } = strapi.contentType(uid);
                    for(const key in obj1){
                        // exclude id, documentid, createdBy and the like
                        if (Object.values(staticAttributes).includes(key)) {
                            continue;
                        }
                        const getField = (fieldname)=>{
                            if (obj1[key]) {
                                if (Array.isArray(obj1[key])) return obj1[key].map((media)=>media[fieldname]);
                                else return obj1[key] ? obj1[key][fieldname] : null;
                            }
                        };
                        // only id/documentId is needed to update relations
                        if (schema[key]?.type == 'media') changes[key] = getField('id');
                        else if (schema[key]?.type == 'relation') changes[key] = getField('documentId');
                        else {
                            changes[key] = obj1[key];
                            if (changes[key] && schema[key]?.type == 'component') {
                                if (Array.isArray(changes[key])) return changes[key].map((component)=>delete component.id);
                                else delete changes[key].id;
                            // -> components can't be reused/reassigned via admin panel but only created
                            // therefore we hopefully never have the situation of overwriting the wrong component
                            }
                        }
                    }
                    return changes;
                };
                params.data = transformData(updatedDraft[0]);
            }
            const updateParams = await strapiUtils.async.pipe(validateParams, // sets query to filter for published or draft
            draftAndPublish.statusToLookup(contentType), // sets publishedAt value
            draftAndPublish.statusToData(contentType), // Default locale will be set if not provided
            internationalization.defaultLocale(contentType), internationalization.localeToLookup(contentType), internationalization.localeToData(contentType))(params);
            // this would normally be handles by entries.publish so it is added here
            params.data['publishedAt'] = new Date();
            publishedEntries = await strapiUtils.async.map(oldPublishedVersions, (published)=>entries$1.update(published, updateParams));
        } else publishedEntries = await strapiUtils.async.map(updatedDraft, (draft)=>entries$1.publish(draft, queryParams));
        publishedEntries.forEach(emitEvent('entry.publish'));
        return {
            documentId,
            entries: publishedEntries
        };
    }
    async function unpublish(opts = {}) {
        const { documentId, ...params } = opts;
        const query$1 = await strapiUtils.async.pipe(validateParams, internationalization.defaultLocale(contentType), internationalization.multiLocaleToLookup(contentType), query.transformParamsToQuery(uid), (query)=>fp.assoc('where', {
                ...query.where,
                documentId,
                publishedAt: {
                    $ne: null
                }
            }, query))(params);
        // Delete all published versions
        const versionsToDelete = await strapi.db.query(uid).findMany(query$1);
        await strapiUtils.async.map(versionsToDelete, (entry)=>entries$1.delete(entry.id));
        versionsToDelete.forEach(emitEvent('entry.unpublish'));
        return {
            documentId,
            entries: versionsToDelete
        };
    }
    async function discardDraft(opts = {}) {
        const { documentId, ...params } = opts;
        const queryParams = await strapiUtils.async.pipe(validateParams, internationalization.defaultLocale(contentType), internationalization.multiLocaleToLookup(contentType))(params);
        const [versionsToDraft, oldDrafts] = await Promise.all([
            strapi.db.query(uid).findMany({
                where: {
                    ...queryParams?.lookup,
                    documentId,
                    publishedAt: {
                        $ne: null
                    }
                },
                // Populate relations, media, compos and dz
                populate: populate.getDeepPopulate(uid, {
                    relationalFields: [
                        'documentId',
                        'locale'
                    ]
                })
            }),
            strapi.db.query(uid).findMany({
                where: {
                    ...queryParams?.lookup,
                    documentId,
                    publishedAt: null
                },
                select: [
                    'id',
                    'locale'
                ]
            })
        ]);
        // Load any unidirectional relation targeting the old drafts
        const relationsToSync = await unidirectionalRelations.load(uid, {
            newVersions: versionsToDraft,
            oldVersions: oldDrafts
        }, {
            shouldPropagateRelation: components.createComponentRelationFilter()
        });
        const bidirectionalRelationsToSync = await bidirectionalRelations.load(uid, {
            newVersions: versionsToDraft,
            oldVersions: oldDrafts
        });
        // Delete old drafts
        await strapiUtils.async.map(oldDrafts, (entry)=>entries$1.delete(entry.id));
        // Transform published entry data and create draft versions
        const draftEntries = await strapiUtils.async.map(versionsToDraft, (entry)=>entries$1.discardDraft(entry, queryParams));
        // Sync unidirectional relations with the new draft entries
        await unidirectionalRelations.sync([
            ...oldDrafts,
            ...versionsToDraft
        ], draftEntries, relationsToSync);
        await bidirectionalRelations.sync([
            ...oldDrafts,
            ...versionsToDraft
        ], draftEntries, bidirectionalRelationsToSync);
        draftEntries.forEach(emitEvent('entry.draft-discard'));
        return {
            documentId,
            entries: draftEntries
        };
    }
    async function updateComponents(entry, data) {
        return components.updateComponents(uid, entry, data);
    }
    function omitComponentData(data) {
        return components.omitComponentData(contentType, data);
    }
    return {
        findMany: common.wrapInTransaction(findMany),
        findFirst: common.wrapInTransaction(findFirst),
        findOne: common.wrapInTransaction(findOne),
        delete: common.wrapInTransaction(deleteDocument),
        create: common.wrapInTransaction(create),
        clone: common.wrapInTransaction(clone),
        update: common.wrapInTransaction(update),
        count: common.wrapInTransaction(count),
        publish: hasDraftAndPublish ? common.wrapInTransaction(publish) : undefined,
        unpublish: hasDraftAndPublish ? common.wrapInTransaction(unpublish) : undefined,
        discardDraft: hasDraftAndPublish ? common.wrapInTransaction(discardDraft) : undefined,
        updateComponents,
        omitComponentData
    };
};

exports.createContentTypeRepository = createContentTypeRepository;
//# sourceMappingURL=repository.js.map
