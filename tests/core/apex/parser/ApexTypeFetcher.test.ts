import { expect } from '@jest/globals';
import * as path from 'path';
import ApexTypeFetcher from '../../../../src/core/apex/parser/ApexTypeFetcher';

describe('Given a directory of apex classes', () => {
    const fetcher = new ApexTypeFetcher(path.join(__dirname, 'resources'));
    const classifiedByType = fetcher.getClassesClassifiedByType();
    const names = (files) => files.map((file) => file.name).sort();

    it('should classify classes and test classes, including those using multiline string literals', () => {
        expect(names(classifiedByType.class)).toEqual(['OpportunityService', 'OpportunityServiceTest']);
        expect(fetcher.getTestClasses()).toEqual(['OpportunityServiceTest']);
    });

    it('should classify interfaces', () => {
        expect(names(classifiedByType.interface)).toEqual(['OpportunitySelector']);
    });

    it('should report classes with syntax errors as parse errors', () => {
        expect(names(classifiedByType.parseError)).toEqual(['BrokenClass']);
    });
});
