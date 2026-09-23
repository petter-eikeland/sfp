@isTest
private class OpportunityServiceTest {
    @isTest
    static void rendersMultilinePayload() {
        String expected = '''
            {
                "name": "test"
            }
            ''';
        Assert.areEqual(expected, OpportunityService.payload());
    }
}
